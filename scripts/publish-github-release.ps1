param(
  [string]$Version,
  [string]$ReleaseDir,
  [string]$NotesPath,
  [switch]$VerifyOnly
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

function Get-ReleaseByTag {
  try {
    return Invoke-RestMethod -Method Get -Uri $releaseByTagUrl -Headers $headers
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    if ($statusCode -eq 404) { return $null }
    throw
  }
}

function Assert-ReleaseAssets([object]$release) {
  if (-not $release) { throw "GitHub release $tag does not exist" }
  $remote = @{}
  foreach ($entry in @($release.assets)) { $remote[[string]$entry.name] = $entry }
  foreach ($assetPath in $assets) {
    $local = Get-Item -LiteralPath $assetPath
    $entry = $remote[$local.Name]
    if (-not $entry) { throw "GitHub release verification failed: missing $($local.Name)" }
    if ([int64]$entry.size -ne [int64]$local.Length) {
      throw "GitHub release verification failed: $($local.Name) has $($entry.size) bytes remotely, expected $($local.Length)"
    }
    if ([string]$entry.state -ne "uploaded") {
      throw "GitHub release verification failed: $($local.Name) state is $($entry.state)"
    }
  }
}

$release = Get-ReleaseByTag
if ($VerifyOnly) {
  Assert-ReleaseAssets $release
  Write-Output "Verified Qnector $tag release: both Windows assets are uploaded with exact sizes."
  exit 0
}

if (-not $release) {
  $notes = if ($NotesPath) {
    [IO.File]::ReadAllText([IO.Path]::GetFullPath($NotesPath), [Text.Encoding]::UTF8)
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
  } | ConvertTo-Json -Compress
  $payloadBytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $release = Invoke-RestMethod -Method Post -Uri "$repositoryApi/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $payloadBytes
}

$uploadBase = [string]$release.upload_url -replace '\{\?name,label\}$', ''
if (-not $uploadBase) { throw "GitHub release did not return an upload URL" }
$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if (-not $curl) { throw "curl.exe is required for resilient GitHub release uploads" }

foreach ($assetPath in $assets) {
  $file = Get-Item -LiteralPath $assetPath
  # Refresh the release before each asset so a retry after a failed previous run
  # can clean up any stale asset with the same name.
  $release = Get-ReleaseByTag
  $existing = @($release.assets | Where-Object { $_.name -eq $file.Name })
  foreach ($old in $existing) {
    Invoke-RestMethod -Method Delete -Uri "$repositoryApi/releases/assets/$($old.id)" -Headers $headers | Out-Null
  }

  $escapedName = [Uri]::EscapeDataString($file.Name)
  $uploadUrl = "${uploadBase}?name=${escapedName}"
  $responsePath = Join-Path $env:TEMP "qnector-release-$Version-$([Guid]::NewGuid().ToString('N')).json"
  try {
    Write-Output "Uploading $($file.Name) ($($file.Length) bytes)..."
    & $curl `
      --http1.1 `
      --fail `
      --show-error `
      --retry 5 `
      --retry-all-errors `
      --retry-delay 2 `
      --connect-timeout 30 `
      --max-time 1800 `
      --request POST `
      --header "Authorization: Bearer $token" `
      --header "Accept: application/vnd.github+json" `
      --header "X-GitHub-Api-Version: 2022-11-28" `
      --header "Content-Type: application/octet-stream" `
      --data-binary "@$($file.FullName)" `
      --output $responsePath `
      $uploadUrl
    if ($LASTEXITCODE -ne 0) { throw "GitHub asset upload failed for $($file.Name) with curl exit code $LASTEXITCODE" }
    $uploaded = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
    if ([string]$uploaded.name -ne $file.Name -or [int64]$uploaded.size -ne [int64]$file.Length) {
      throw "GitHub asset upload response did not match $($file.Name)"
    }
    Write-Output "Uploaded $($uploaded.name) ($($uploaded.size) bytes)"
  } finally {
    Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
  }
}

$verified = Get-ReleaseByTag
Assert-ReleaseAssets $verified
Write-Output "Published Qnector $tag assets to $($verified.html_url)"
