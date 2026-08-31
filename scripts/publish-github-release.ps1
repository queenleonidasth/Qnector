param(
  [string]$Version,
  [string]$ReleaseDir,
  [string]$NotesPath
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $Version) {
  $package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  $Version = [string]$package.version
}
if (-not $Version) { throw "Could not determine Qnector version" }
$tag = "v$Version"

& git rev-parse --verify "refs/tags/$tag" *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Git tag $tag does not exist. Commit, tag, and push the release before publishing assets."
}

$releaseRoot = Join-Path $projectRoot "apps\desktop\release"
if (-not $ReleaseDir) {
  $portable = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File -Filter "Qnector-$Version-win-x64-portable.exe" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $portable) { throw "Could not find Qnector-$Version-win-x64-portable.exe under $releaseRoot" }
  $ReleaseDir = $portable.DirectoryName
}
$ReleaseDir = [IO.Path]::GetFullPath($ReleaseDir)

$assets = @(
  (Join-Path $ReleaseDir "Qnector-$Version-win-x64-setup.exe")
  (Join-Path $ReleaseDir "Qnector-$Version-win-x64-portable.exe")
)
foreach ($asset in $assets) {
  if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) { throw "Release asset is missing: $asset" }
}

$credentialLines = "protocol=https`nhost=github.com`n`n" | & git credential fill
if ($LASTEXITCODE -ne 0) { throw "Could not read GitHub credentials from Git credential manager" }
$credential = @{}
foreach ($line in $credentialLines) {
  $parts = $line -split "=", 2
  if ($parts.Count -eq 2) { $credential[$parts[0]] = $parts[1] }
}
$token = [string]$credential.password
if (-not $token) { throw "Git credential manager did not return a GitHub token" }

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "Qnector-release-publisher/$Version"
}
$repositoryApi = "https://api.github.com/repos/queenleonidasth/Qnector"
$releaseByTagUrl = "$repositoryApi/releases/tags/$tag"

try {
  $release = Invoke-RestMethod -Method Get -Uri $releaseByTagUrl -Headers $headers
} catch {
  $statusCode = $null
  if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
  if ($statusCode -ne 404) { throw }

  $notes = if ($NotesPath) {
    Get-Content -LiteralPath $NotesPath -Raw
  } else {
    "Qnector $tag release. See the repository history for details."
  }
  $payload = @{
    tag_name = $tag
    target_commitish = "main"
    name = "Qnector $tag"
    body = $notes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Method Post -Uri "$repositoryApi/releases" -Headers $headers -ContentType "application/json" -Body $payload
}

$uploadBase = [string]$release.upload_url -replace '\{\?name,label\}$', ''
if (-not $uploadBase) { throw "GitHub release did not return an upload URL" }

Add-Type -AssemblyName System.Net.Http
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(20)
$client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $token)
$client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json")
$client.DefaultRequestHeaders.UserAgent.ParseAdd("Qnector-release-publisher/$Version")
$client.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28")

try {
  foreach ($assetPath in $assets) {
    $file = Get-Item -LiteralPath $assetPath
    $existing = @($release.assets | Where-Object { $_.name -eq $file.Name })
    foreach ($old in $existing) {
      Invoke-RestMethod -Method Delete -Uri "$repositoryApi/releases/assets/$($old.id)" -Headers $headers | Out-Null
    }

    $escapedName = [Uri]::EscapeDataString($file.Name)
    $uploadUrl = "$uploadBase?name=$escapedName"
    $stream = [IO.File]::OpenRead($file.FullName)
    try {
      $content = [Net.Http.StreamContent]::new($stream)
      $content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("application/octet-stream")
      $response = $client.PostAsync($uploadUrl, $content).GetAwaiter().GetResult()
      $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if (-not $response.IsSuccessStatusCode) {
        throw "GitHub asset upload failed for $($file.Name): HTTP $([int]$response.StatusCode) $responseBody"
      }
      $uploaded = $responseBody | ConvertFrom-Json
      Write-Output "Uploaded $($uploaded.name) ($($uploaded.size) bytes)"
    } finally {
      $stream.Dispose()
    }
  }
} finally {
  $client.Dispose()
}

$verified = Invoke-RestMethod -Method Get -Uri $releaseByTagUrl -Headers $headers
$uploadedNames = @($verified.assets | ForEach-Object { $_.name })
foreach ($assetPath in $assets) {
  $name = [IO.Path]::GetFileName($assetPath)
  if ($uploadedNames -notcontains $name) { throw "GitHub release verification failed: missing $name" }
}

Write-Output "Published Qnector $tag assets to $($verified.html_url)"
