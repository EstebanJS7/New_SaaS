#Requires -Version 7.2
param(
    [string]$HostAddress = $env:PREFLIGHT_HOST,
    [int]$PostgresPort = [int]::Parse($env:POSTGRES_PORT ?? "5432"),
    [int]$RedisPort = [int]::Parse($env:REDIS_PORT ?? "6379")
)

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not $HostAddress) {
    $HostAddress = "127.0.0.1"
}

$env:PREFLIGHT_HOST = $HostAddress
$env:POSTGRES_PORT = $PostgresPort
$env:REDIS_PORT = $RedisPort

Write-Host "Checking local services on ${HostAddress}..."

$cliDist = Join-Path $rootDir "packages\preflight\dist\cli.js"
if (-not (Test-Path $cliDist)) {
    Write-Error "Preflight CLI not built. Run 'pnpm build' first."
}

$nodeArgs = @()
$envFile = Join-Path $rootDir ".env"
if (Test-Path $envFile) {
    $nodeArgs += @("--env-file", $envFile)
}

& node @nodeArgs $cliDist

exit $LASTEXITCODE
