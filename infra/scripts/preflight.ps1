#Requires -Version 7.2
param(
    [string]$HostAddress = $env:PREFLIGHT_HOST,
    [string]$PostgresPort = $env:POSTGRES_PORT,
    [string]$RedisPort = $env:REDIS_PORT
)

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Read-DotEnv {
    param([string]$Path)
    $values = @{}
    if (-not (Test-Path $Path)) {
        return $values
    }
    foreach ($line in Get-Content -Path $Path) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
            continue
        }
        if ($trimmed -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $values[$matches[1]] = $matches[2]
        }
    }
    return $values
}

function Resolve-Port {
    param(
        [string]$Value,
        [string]$EnvName,
        [string]$Default,
        [string]$DotEnvValue
    )
    $raw = $Value
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $raw = $DotEnvValue
    }
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $raw = $Default
    }
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "${EnvName} is not set and has no default."
    }
    $parsed = 0
    if (-not [int]::TryParse($raw, [ref]$parsed)) {
        throw "${EnvName} must be an integer between 1 and 65535; got '${raw}'."
    }
    if ($parsed -lt 1 -or $parsed -gt 65535) {
        throw "${EnvName} must be an integer between 1 and 65535; got ${parsed}."
    }
    return $parsed
}

$envFile = Join-Path $rootDir ".env"
$dotEnv = Read-DotEnv -Path $envFile

if ([string]::IsNullOrWhiteSpace($HostAddress)) {
    $HostAddress = $dotEnv["PREFLIGHT_HOST"]
}
if ([string]::IsNullOrWhiteSpace($HostAddress)) {
    $HostAddress = "127.0.0.1"
}

$PostgresPort = Resolve-Port -Value $PostgresPort -EnvName "POSTGRES_PORT" -Default "5432" -DotEnvValue $dotEnv["POSTGRES_PORT"]
$RedisPort = Resolve-Port -Value $RedisPort -EnvName "REDIS_PORT" -Default "6379" -DotEnvValue $dotEnv["REDIS_PORT"]

$env:PREFLIGHT_HOST = $HostAddress
$env:POSTGRES_PORT = $PostgresPort
$env:REDIS_PORT = $RedisPort

Write-Host "Checking local services on ${HostAddress}..."

$cliDist = Join-Path $rootDir "packages\preflight\dist\cli.js"
if (-not (Test-Path $cliDist)) {
    Write-Error "Preflight CLI not built. Run 'pnpm build' first."
}

$nodeArgs = @()
if (Test-Path $envFile) {
    $nodeArgs += @("--env-file", $envFile)
}

& node @nodeArgs $cliDist

exit $LASTEXITCODE
