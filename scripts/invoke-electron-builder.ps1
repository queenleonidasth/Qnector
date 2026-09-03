param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [ValidateSet("all", "portable")]
  [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $projectRoot "apps\desktop"
$customPortableTemplate = Join-Path $desktopRoot "build\portable-cache.nsi"
if (-not (Test-Path -LiteralPath $customPortableTemplate -PathType Leaf)) {
  throw "Qnector portable NSIS template is missing: $customPortableTemplate"
}

$portableTemplate = Get-ChildItem -LiteralPath (Join-Path $projectRoot "node_modules\.pnpm") -Directory -Filter "app-builder-lib@*" |
  ForEach-Object { Join-Path $_.FullName "node_modules\app-builder-lib\templates\nsis\portable.nsi" } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (-not $portableTemplate) {
  throw "Could not locate electron-builder's portable.nsi template"
}

$recoveryBackup = "$portableTemplate.qnector-original"
if (Test-Path -LiteralPath $recoveryBackup -PathType Leaf) {
  Copy-Item -LiteralPath $recoveryBackup -Destination $portableTemplate -Force
}

$originalTemplate = [IO.File]::ReadAllBytes($portableTemplate)
$originalText = [Text.Encoding]::UTF8.GetString($originalTemplate)
if ($originalText -notmatch 'RMDir /r \$INSTDIR' -or $originalText -notmatch 'PORTABLE_EXECUTABLE_FILE') {
  throw "electron-builder portable.nsi no longer matches the Qnector compatibility guard"
}
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $originalHash = ([BitConverter]::ToString($sha256.ComputeHash($originalTemplate))).Replace("-", "")
} finally {
  $sha256.Dispose()
}
[IO.File]::WriteAllBytes($recoveryBackup, $originalTemplate)

$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$corepackCommand = (Get-Command corepack -ErrorAction Stop).Source
$pnpmShimDir = Join-Path ([IO.Path]::GetTempPath()) "qnector-pnpm-shim-$PID"
$pnpmShimPath = Join-Path $pnpmShimDir "pnpm.cmd"
$originalPath = $env:PATH
New-Item -ItemType Directory -Path $pnpmShimDir -Force | Out-Null
[IO.File]::WriteAllText(
  $pnpmShimPath,
  "@echo off`r`n`"$corepackCommand`" pnpm %*`r`n",
  [Text.Encoding]::ASCII
)
$env:PATH = "$pnpmShimDir;$originalPath"

try {
  Copy-Item -LiteralPath $customPortableTemplate -Destination $portableTemplate -Force
  Push-Location $desktopRoot
  try {
    $builderArgs = @(
      "electron-builder",
      "--config", "electron-builder.yml",
      "--config.npmRebuild=false",
      "--x64",
      "--config.directories.output=$resolvedOutput"
    )
    if ($Target -eq "portable") {
      $builderArgs += @("--win", "portable")
    } else {
      $builderArgs += "--win"
    }
    $corepackArgs = @("pnpm", "exec") + $builderArgs
    & corepack @corepackArgs
    if ($LASTEXITCODE -ne 0) {
      throw "electron-builder failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
} finally {
  [IO.File]::WriteAllBytes($portableTemplate, $originalTemplate)
  $env:PATH = $originalPath
  Remove-Item -LiteralPath $pnpmShimDir -Recurse -Force -ErrorAction SilentlyContinue
}

$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $restoredBytes = [IO.File]::ReadAllBytes($portableTemplate)
  $restoredHash = ([BitConverter]::ToString($sha256.ComputeHash($restoredBytes))).Replace("-", "")
} finally {
  $sha256.Dispose()
}
if ($restoredHash -ne $originalHash) {
  throw "electron-builder portable.nsi was not restored after packaging"
}
Remove-Item -LiteralPath $recoveryBackup -Force -ErrorAction SilentlyContinue

Write-Output "Qnector electron-builder packaging completed: $resolvedOutput"
