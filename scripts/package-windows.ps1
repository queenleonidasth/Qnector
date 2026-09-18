$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
# A clean release worktree has no workspace dist yet. Build dependencies before
# bundling the durable daemon, which imports @qnector/execution/dist/index.js.
$pnpm = (Get-Command "pnpm.cmd" -ErrorAction Stop).Source
& $pnpm build
if ($LASTEXITCODE -ne 0) { throw "Initial workspace build failed; refusing to package" }
$dotnet = Join-Path $env:ProgramFiles "dotnet\dotnet.exe"
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = "dotnet" }
& $dotnet publish (Join-Path $projectRoot "tools\uia-helper\Qnector.UiaHelper.csproj") -c Release -r win-x64 --self-contained true -o (Join-Path $projectRoot "tools\uia-helper\publish")
if ($LASTEXITCODE -ne 0) { throw "Failed to publish qnector-uia helper" }
& (Join-Path $PSScriptRoot "build-job-host.ps1")
if ($LASTEXITCODE -ne 0) { throw "Failed to publish Qnector Job Object host" }
& node (Join-Path $PSScriptRoot "build-durable-runtime.mjs")
if ($LASTEXITCODE -ne 0) { throw "Failed to bundle Qnector durable daemon and worker" }
& node (Join-Path $PSScriptRoot "smoke-durable-bundle.mjs")
if ($LASTEXITCODE -ne 0) { throw "Durable daemon/worker bundle smoke failed; refusing to package" }
& node (Join-Path $PSScriptRoot "smoke-durable-recovery.mjs")
if ($LASTEXITCODE -ne 0) { throw "Durable daemon restart recovery failed; refusing to package" }
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

# Bind every packaged executable to the exact source revision and lockfile used
# to build it. The manifest is copied beside app.asar so system.build_info can
# report provenance from the installed/portable artifact itself.
$sourceRevision = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRevision -notmatch '^[0-9a-fA-F]{40}$') { throw "Could not resolve Git source revision for build provenance" }
$gitStatus = ((& git status --porcelain=v1 --untracked-files=all) -join "`n").Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not inspect Git status for build provenance" }
$lockfilePath = Join-Path $projectRoot "pnpm-lock.yaml"
if (-not (Test-Path -LiteralPath $lockfilePath -PathType Leaf)) { throw "pnpm-lock.yaml is missing" }
$lockfileSha256 = (Get-FileHash -LiteralPath $lockfilePath -Algorithm SHA256).Hash
$provenancePath = Join-Path $projectRoot "apps\desktop\resources\build-provenance.json"
$provenance = [ordered]@{
  version = 1
  generatedAt = [DateTime]::UtcNow.ToString("o")
  sourceRevision = $sourceRevision.ToLowerInvariant()
  dirtyTree = -not [string]::IsNullOrWhiteSpace($gitStatus)
  lockfileSha256 = $lockfileSha256.ToLowerInvariant()
}
[IO.File]::WriteAllText(
  $provenancePath,
  (($provenance | ConvertTo-Json -Depth 3) + "`n"),
  [Text.UTF8Encoding]::new($false)
)

# Release gate: validate updater safety plus the desktop UI regressions that can
# make a packaged build unusable at Qnector's narrow production window size.
# Use pnpm.cmd directly: invoking pnpm through npx makes npm warnings on stderr fatal
# under Windows PowerShell when $ErrorActionPreference is Stop.
$pnpm = (Get-Command "pnpm.cmd" -ErrorAction Stop).Source
& $pnpm vitest run apps/desktop/src/main/updater-script.test.ts apps/desktop/src/main/updater-core.test.ts apps/desktop/src/main/updater-e2e.test.ts apps/desktop/src/main/startup-splash.test.ts apps/desktop/src/main/durable-daemon.test.ts apps/desktop/src/main/durable-jobs.test.ts apps/daemon/src/private-root.test.ts apps/daemon/src/server.test.ts apps/daemon/src/cancel.test.ts apps/daemon/src/crash-recovery.test.ts apps/desktop/src/main/release-pipeline.test.ts apps/desktop/src/renderer/styles.test.ts apps/desktop/src/renderer/royal-effects.test.ts apps/desktop/src/renderer/gold-matrix-rain.test.ts apps/desktop/src/renderer/window-animation.test.ts apps/desktop/src/renderer/scroll-completeness.test.ts apps/desktop/src/renderer/qc-regressions.test.ts apps/desktop/src/renderer/skill-manager.test.ts apps/desktop/src/renderer/activity-feed.test.ts packages/tools/src/tools.test.ts packages/tools/src/skill-routing-guard.test.ts packages/mcp-server/src/session-bootstrap.test.ts packages/mcp-server/src/server.test.ts packages/mcp-server/src/durable-task-mcp.test.ts packages/mcp-server/src/mcp-reliability.test.ts packages/mcp-server/src/stdio-log-guard.test.ts packages/execution/src/windows-job-host.test.ts --maxWorkers=2
if ($LASTEXITCODE -ne 0) { throw "Desktop release regression gate failed; refusing to package" }
& $pnpm vitest run packages/tools/src/external-mcp.test.ts
if ($LASTEXITCODE -ne 0) { throw "External MCP integration gate failed; refusing to package" }
& (Join-Path $PSScriptRoot "accept-skill-layout.ps1")
if ($LASTEXITCODE -ne 0) { throw "Skill discovery layout gate failed; refusing to package" }
& $pnpm build:clean
if ($LASTEXITCODE -ne 0) { throw "Qnector clean build failed; refusing to package" }
# The CLI test executes compiled dist: run it only after a clean build so a
# stale local dist cannot falsely pass a release gate.
& $pnpm vitest run packages/mcp-server/src/stdio-parity.test.ts packages/mcp-server/src/stdio-cli.test.ts
if ($LASTEXITCODE -ne 0) { throw "HTTP/stdio durable parity failed; refusing to package" }
# Build into a unique candidate directory. Never delete or overwrite an older
# release before every gate (including the packaged executable smoke) passes.
$releaseRoot = Join-Path $projectRoot "apps\desktop\release"
$releaseDir = Join-Path $releaseRoot ("durable-candidate-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
& (Join-Path $PSScriptRoot "invoke-electron-builder.ps1") -OutputDirectory $releaseDir -Target all
if ($LASTEXITCODE -ne 0) { throw "Failed to package Qnector desktop artifacts" }

$resourceRoot = Join-Path $releaseDir "win-unpacked\resources"
$requiredPackagedResources = @(
  "uia-helper\qnector-uia.exe",
  "durable-runtime\qnector-job-host.exe",
  "durable-runtime\daemon.mjs",
  "durable-runtime\worker-main.js",
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
  "typescript-lib\lib.dom.d.ts",
  "build-provenance.json"
)
foreach ($relative in $requiredPackagedResources) {
  $candidate = Join-Path $resourceRoot $relative
  if (-not (Test-Path -LiteralPath $candidate)) { throw "Packaged resource is missing: $candidate" }
}

# Execute the actual packaged Electron binary in Node mode, not the developer's
# node.exe, so an Electron/Node/SQLite or extraResources mismatch blocks release.
$packagedExecutable = Join-Path $releaseDir "win-unpacked\Qnector.exe"
if (-not (Test-Path -LiteralPath $packagedExecutable -PathType Leaf)) {
  throw "Packaged Windows executable is missing: $packagedExecutable"
}
$previousBundleDir = $env:QNECTOR_SMOKE_BUNDLE_DIR
$previousExecutable = $env:QNECTOR_SMOKE_EXECUTABLE
$previousStdioCli = $env:QNECTOR_SMOKE_STDIO_CLI
try {
  $env:QNECTOR_SMOKE_BUNDLE_DIR = Join-Path $resourceRoot "durable-runtime"
  $env:QNECTOR_SMOKE_EXECUTABLE = $packagedExecutable
  & node (Join-Path $PSScriptRoot "smoke-durable-bundle.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Packaged Electron durable runtime smoke failed; refusing release" }
  & node (Join-Path $PSScriptRoot "smoke-durable-recovery.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Packaged Electron daemon restart recovery failed; refusing release" }
  $env:QNECTOR_SMOKE_STDIO_CLI = Join-Path $resourceRoot "app.asar\node_modules\@qnector\mcp-server\dist\stdio-cli.js"
  & node (Join-Path $PSScriptRoot "smoke-stdio-package.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Packaged Electron stdio frontend smoke failed; refusing release" }
} finally {
  $env:QNECTOR_SMOKE_BUNDLE_DIR = $previousBundleDir
  $env:QNECTOR_SMOKE_EXECUTABLE = $previousExecutable
  $env:QNECTOR_SMOKE_STDIO_CLI = $previousStdioCli
}
