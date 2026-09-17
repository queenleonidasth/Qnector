$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $env:ProgramFiles "dotnet\dotnet.exe"
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
$project = Join-Path $projectRoot "packages\execution\job-host\Qnector.JobHost.csproj"
$output = Join-Path $projectRoot "packages\execution\job-host\dist"
& $dotnet publish $project -c Release -r win-x64 --self-contained true -o $output
if ($LASTEXITCODE -ne 0) { throw "Failed to publish Qnector Windows Job Object host" }
$exe = Join-Path $output "qnector-job-host.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Qnector Job Object host was not produced: $exe" }
Write-Output $exe
