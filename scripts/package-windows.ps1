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
# Release gate: validate updater safety plus the desktop UI regressions that can
# make a packaged build unusable at Qnector's narrow production window size.
# Use pnpm.cmd directly: invoking pnpm through npx makes npm warnings on stderr fatal
# under Windows PowerShell when $ErrorActionPreference is Stop.
$pnpm = (Get-Command "pnpm.cmd" -ErrorAction Stop).Source
& $pnpm vitest run apps/desktop/src/main/updater-script.test.ts apps/desktop/src/main/updater-core.test.ts apps/desktop/src/main/updater-e2e.test.ts apps/desktop/src/main/startup-splash.test.ts apps/desktop/src/main/release-pipeline.test.ts apps/desktop/src/renderer/styles.test.ts apps/desktop/src/renderer/scroll-completeness.test.ts apps/desktop/src/renderer/qc-regressions.test.ts apps/desktop/src/renderer/skill-manager.test.ts apps/desktop/src/renderer/activity-feed.test.ts
if ($LASTEXITCODE -ne 0) { throw "Desktop release regression gate failed; refusing to package" }
& (Join-Path $PSScriptRoot "accept-skill-layout.ps1")
if ($LASTEXITCODE -ne 0) { throw "Skill discovery layout gate failed; refusing to package" }
& $pnpm build:clean
if ($LASTEXITCODE -ne 0) { throw "Qnector clean build failed; refusing to package" }
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
