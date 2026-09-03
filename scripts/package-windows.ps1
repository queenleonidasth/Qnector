$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$dotnet = Join-Path $env:ProgramFiles "dotnet\dotnet.exe"
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = "dotnet" }
& $dotnet publish (Join-Path $projectRoot "tools\uia-helper\Qnector.UiaHelper.csproj") -c Release -r win-x64 --self-contained true -o (Join-Path $projectRoot "tools\uia-helper\publish")
if ($LASTEXITCODE -ne 0) { throw "Failed to publish qnector-uia helper" }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "tools\everything-cli\es.exe"))) { throw "Everything CLI tools\everything-cli\es.exe is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "tools\ripgrep\rg.exe"))) { throw "Ripgrep tools\ripgrep\rg.exe is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "tools\ripgrep\LICENSE-MIT"))) { throw "Ripgrep tools\ripgrep\LICENSE-MIT is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "tools\ripgrep\UNLICENSE"))) { throw "Ripgrep tools\ripgrep\UNLICENSE is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "tools\tunnel-client\tunnel-client.exe"))) { throw "OpenAI tunnel client tools\tunnel-client\tunnel-client.exe is missing" }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "tools\tunnel-client\cloudflared.exe"))) { throw "OpenAI tunnel companion tools\tunnel-client\cloudflared.exe is missing" }
$typescriptLib = Join-Path $projectRoot "node_modules\typescript\lib"
foreach ($lib in @("lib.d.ts", "lib.es2022.d.ts", "lib.dom.d.ts")) {
  if (-not (Test-Path -LiteralPath (Join-Path $typescriptLib $lib))) { throw "TypeScript standard library $lib is missing" }
}
npx pnpm@10.15.0 build:clean
$releaseDir = Join-Path $projectRoot "apps\desktop\release"
if (Test-Path -LiteralPath $releaseDir) {
  try {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force -ErrorAction Stop
  } catch {
    $suffix = Get-Date -Format "yyyyMMdd-HHmmss"
    $releaseDir = Join-Path $releaseDir "retry-$suffix"
    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
    Write-Warning "The existing release directory is in use; writing artifacts to $releaseDir"
  }
}
& (Join-Path $PSScriptRoot "invoke-electron-builder.ps1") -OutputDirectory $releaseDir -Target all
if ($LASTEXITCODE -ne 0) { throw "Failed to package Qnector desktop artifacts" }

$resourceRoot = Join-Path $releaseDir "win-unpacked\resources"
$requiredPackagedResources = @(
  "uia-helper\qnector-uia.exe",
  "everything-cli\es.exe",
  "ripgrep\rg.exe",
  "ripgrep\LICENSE-MIT",
  "ripgrep\UNLICENSE",
  "openai-tunnel\tunnel-client.exe",
  "openai-tunnel\cloudflared.exe",
  "openai-tunnel\LICENSE",
  "openai-tunnel\NOTICE",
  "typescript-lib\lib.d.ts",
  "typescript-lib\lib.es2022.d.ts",
  "typescript-lib\lib.dom.d.ts"
)
foreach ($relative in $requiredPackagedResources) {
  $candidate = Join-Path $resourceRoot $relative
  if (-not (Test-Path -LiteralPath $candidate)) { throw "Packaged resource is missing: $candidate" }
}
