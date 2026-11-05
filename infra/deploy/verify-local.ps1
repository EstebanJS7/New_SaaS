<#
.SYNOPSIS
  Verifica en Docker Desktop el stack de producción de infra/deploy.

.DESCRIPTION
  1. Construye las cuatro imágenes (api, worker, web, migrate) del Dockerfile.
  2. Levanta docker-compose.prod.yml con secretos de prueba generados al vuelo,
     sin Caddy y con puertos locales 18080 (web) y 18081 (API).
  3. Comprueba que las migraciones terminan bien y que la API y la web responden.
  4. Simulacro de respaldo: espera el primer respaldo completo de pgBackRest,
     escribe dos filas, restaura al instante entre ambas y comprueba que solo
     sobrevive la primera (recuperación a un momento dado, PITR).
  5. Guarda todo en infra/deploy/.verify/verify-local.log y apaga el stack.

  Usa un proyecto de Compose propio (newsaas-verify), así que no toca los
  contenedores ni los datos del entorno de desarrollo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File infra\deploy\verify-local.ps1

.EXAMPLE
  # Deja el stack levantado para mirarlo en http://localhost:18080
  powershell -ExecutionPolicy Bypass -File infra\deploy\verify-local.ps1 -KeepRunning
#>
param(
  [switch]$KeepRunning,
  [switch]$SkipBuild,
  [switch]$SkipBackupDrill
)

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

$work = Join-Path $PSScriptRoot ".verify"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$log = Join-Path $work "verify-local.log"
Set-Content -Path $log -Value "" -Encoding UTF8

$project = "newsaas-verify"
$tag = "verify"
$registry = "local"
$envFile = Join-Path $work "env"
$override = Join-Path $work "compose.override.yml"
$composeFile = Join-Path $PSScriptRoot "docker-compose.prod.yml"
$script:failed = $false

function Log([string]$text) {
  Add-Content -Path $log -Value $text -Encoding UTF8
  Write-Host $text
}

# Ejecuta un comando nativo, copia su salida al log y devuelve $true si salió bien.
function Step([string]$name, [scriptblock]$command) {
  Log ""
  Log "=== $name  [$(Get-Date -Format 'HH:mm:ss')]"
  & $command 2>&1 | ForEach-Object {
    $line = "$_"
    # PowerShell 5.1 envuelve cada línea vacía de stderr en este texto.
    if ($line -eq "System.Management.Automation.RemoteException") { return }
    Add-Content -Path $log -Value $line -Encoding UTF8
    Write-Host $line
  }
  if ($LASTEXITCODE -ne 0) {
    Log "*** FALLÓ: $name (código $LASTEXITCODE)"
    $script:failed = $true
    return $false
  }
  Log "--- OK: $name"
  return $true
}

function Compose {
  docker compose -p $project -f $composeFile -f $override --env-file $envFile @args
}

function New-Hex([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

function New-Base64([int]$bytes = 32) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer)
}

function Finish {
  Log ""
  Log "=== Estado final de los contenedores"
  Compose ps -a 2>&1 | ForEach-Object { Log "$_" }
  Log ""
  Log "=== Logs de la aplicación (últimas 150 líneas por servicio)"
  foreach ($svc in @("migrate", "api", "worker", "web", "postgres", "backup")) {
    Log "----- $svc"
    Compose logs --no-color --tail=150 $svc 2>&1 | ForEach-Object { Log "$_" }
  }
  if (-not $KeepRunning) {
    Log ""
    Log "=== Apagando y borrando el stack de verificación"
    Compose down -v --remove-orphans 2>&1 | ForEach-Object { Log "$_" }
  } else {
    Log ""
    Log "Stack levantado: web http://localhost:18080 , API http://localhost:18081"
    Log "Para apagarlo: docker compose -p $project down -v"
  }
  Log ""
  if ($script:failed) {
    Log "RESULTADO: FALLÓ. Log completo en $log"
    exit 1
  }
  Log "RESULTADO: OK. Log completo en $log"
  exit 0
}

Log "Verificación local del stack de producción - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Log "Repositorio: $repo"
Log "Commit: $(git rev-parse --short HEAD 2>$null)"

# --- 0. Docker disponible --------------------------------------------------------
if (-not (Step "Docker Desktop responde" { docker version --format "cliente {{.Client.Version}} / servidor {{.Server.Version}}" })) {
  Log "Abrí Docker Desktop, esperá a que diga 'Engine running' y volvé a ejecutar."
  exit 1
}

# --- 1. Entorno de prueba (secretos nuevos en cada corrida) ------------------------
$envLines = @(
  "APP_DOMAIN=app.verify.test",
  "API_DOMAIN=api.verify.test",
  "ACME_EMAIL=verify@verify.test",
  "IMAGE_REGISTRY=$registry",
  "IMAGE_TAG=$tag",
  "POSTGRES_USER=newsaas",
  "POSTGRES_PASSWORD=$(New-Hex)",
  "POSTGRES_DB=newsaas",
  "REDIS_PASSWORD=$(New-Hex)",
  "MINIO_ROOT_USER=newsaas",
  "MINIO_ROOT_PASSWORD=$(New-Hex)",
  "STORAGE_S3_BUCKET=newsaas",
  "STORAGE_S3_REGION=us-east-1",
  "BRANDING_ASSETS_ENABLED=true",
  "BRANDING_ASSET_URL_SECRET=$(New-Hex)",
  "SECRET_STORE_MASTER_KEYS=1:$(New-Base64)",
  "FISCAL_PROVIDER=fake",
  "SIFEN_ENVIRONMENT=TEST",
  "EMAIL_PROVIDER=fake",
  "SMTP_PORT=587",
  "SMTP_SECURE=false",
  "WHATSAPP_PROVIDER=fake",
  "WHATSAPP_CLOUD_TEMPLATE_LANGUAGE=es",
  # Repositorio de respaldos en un volumen local: solo para esta prueba. En el
  # VPS es S3 externo (BACKUP_REPO_TYPE=s3).
  "BACKUP_REPO_TYPE=posix",
  "BACKUP_REPO_PATH=/var/lib/pgbackrest",
  "BACKUP_CIPHER_PASS=$(New-Hex)"
)
# UTF-8 sin BOM: Compose no reconoce la primera variable si el archivo lleva BOM.
[System.IO.File]::WriteAllLines($envFile, $envLines, (New-Object System.Text.UTF8Encoding $false))

$overrideText = @"
# Generado por verify-local.ps1. Sin Caddy y con puertos locales.
services:
  caddy:
    profiles: ["disabled"]
  web:
    ports:
      - "18080:3000"
  api:
    ports:
      - "18081:3001"
"@
[System.IO.File]::WriteAllText($override, $overrideText, (New-Object System.Text.UTF8Encoding $false))
Log "Entorno de prueba generado en $work (no se versiona)."

# --- 2. Build de las imágenes ------------------------------------------------------
if (-not $SkipBuild) {
  $pgImage = "$registry/newsaas-postgres:$tag"
  $ok = Step "Build postgres (pgBackRest) -> $pgImage" {
    docker build --progress=plain -t $pgImage infra/deploy/postgres
  }
  if (-not $ok) { Finish }
  foreach ($target in @("api", "worker", "web", "migrate")) {
    $image = "$registry/newsaas-${target}:$tag"
    $ok = Step "Build $target -> $image" {
      docker build --progress=plain -f infra/deploy/Dockerfile --target $target -t $image .
    }
    if (-not $ok) { Finish }
  }
} else {
  Log "Build omitida (-SkipBuild): se usan las imágenes $registry/newsaas-*:$tag existentes."
}

# --- 3. Configuración de Compose -----------------------------------------------------
if (-not (Step "docker compose config" { Compose config --quiet })) { Finish }

# --- 4. Arranque ---------------------------------------------------------------------
# Restos de una corrida anterior interrumpida.
Compose down -v --remove-orphans 2>&1 | Out-Null

if (-not (Step "Infraestructura (postgres, redis, minio)" { Compose up -d --wait postgres redis minio })) { Finish }
if (-not (Step "Migraciones y datos de referencia (2 veces: debe ser idempotente)" {
      Compose run --rm migrate
      if ($LASTEXITCODE -eq 0) { Compose run --rm migrate }
    })) { Finish }
if (-not (Step "API, worker y web" { Compose up -d --no-recreate })) { Finish }

Log ""
Log "=== Esperando a que la API y la web estén sanas (hasta 180 s)"
$healthy = $false
for ($i = 0; $i -lt 36; $i++) {
  $states = @()
  foreach ($svc in @("api", "web")) {
    $id = (Compose ps -q $svc 2>$null | Select-Object -First 1)
    if ($id) { $states += (docker inspect -f "{{.State.Health.Status}}" $id 2>$null) } else { $states += "ausente" }
  }
  if (($states | Where-Object { $_ -ne "healthy" }).Count -eq 0) { $healthy = $true; break }
  Start-Sleep -Seconds 5
}
if ($healthy) {
  Log "--- OK: api y web healthy"
} else {
  Log "*** FALLÓ: api/web no quedaron healthy (estado: $($states -join ', '))"
  $script:failed = $true
  Finish
}

# --- 5. Comprobaciones HTTP ----------------------------------------------------------
$checks = @(
  @{ Name = "API /health/live"; Url = "http://localhost:18081/health/live"; Max = 299 },
  @{ Name = "API /health/ready"; Url = "http://localhost:18081/health/ready"; Max = 299 },
  @{ Name = "Web /api/health/live"; Url = "http://localhost:18080/api/health/live"; Max = 299 },
  @{ Name = "Web /login"; Url = "http://localhost:18080/login"; Max = 399 }
)
Log ""
Log "=== Comprobaciones HTTP"
foreach ($check in $checks) {
  try {
    $response = Invoke-WebRequest -Uri $check.Url -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction Stop
    $status = [int]$response.StatusCode
    $body = $response.Content
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $body = $_.Exception.Message
  }
  if ($status -ge 200 -and $status -le $check.Max) {
    Log "OK    $($check.Name) -> $status"
  } else {
    Log "FALLA $($check.Name) -> $status"
    $script:failed = $true
  }
  if ($body) {
    $snippet = "$body"
    if ($snippet.Length -gt 300) { $snippet = $snippet.Substring(0, 300) + "..." }
    if ($check.Name -notlike "Web /login") { Log "      $snippet" }
  }
}

# --- 6. El worker sigue vivo ---------------------------------------------------------
Start-Sleep -Seconds 10
$workerState = (Compose ps --format "{{.Service}} {{.State}}" worker 2>$null) -join " "
if ($workerState -match "running") {
  Log "OK    worker en ejecución ($workerState)"
} else {
  Log "FALLA worker no está en ejecución ($workerState)"
  $script:failed = $true
}

# --- 7. Simulacro de respaldo y PITR -----------------------------------------------
function Psql([string]$sql) {
  $out = Compose exec -T postgres psql -U newsaas -d newsaas -v ON_ERROR_STOP=1 -tAc $sql 2>&1
  return (($out | ForEach-Object { "$_" }) -join "`n").Trim()
}

if (-not $SkipBackupDrill -and -not $script:failed) {
  Log ""
  Log "=== Simulacro de respaldo y recuperación a un momento dado"
  Log "Esperando el primer respaldo completo (hasta 10 min)..."
  $backupOk = $false
  for ($i = 0; $i -lt 120; $i++) {
    Compose exec -T backup test -s /tmp/pgbackrest/last-success 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $backupOk = $true; break }
    Start-Sleep -Seconds 5
  }
  if (-not $backupOk) {
    Log "*** FALLÓ: no hubo respaldo completo en 10 min"
    $script:failed = $true
    Finish
  }
  Step "Repositorio de respaldos" { Compose exec -T backup pgbackrest info } | Out-Null

  Log (Psql "CREATE TABLE IF NOT EXISTS restore_drill (label text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())")
  Log (Psql "INSERT INTO restore_drill (label) VALUES ('antes')")
  Start-Sleep -Seconds 2
  $target = Psql "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'"
  Log "Destino de la recuperación: $target"
  Start-Sleep -Seconds 2
  Log (Psql "INSERT INTO restore_drill (label) VALUES ('despues')")
  Log "Filas antes de restaurar: $(Psql "SELECT string_agg(label, ',' ORDER BY label) FROM restore_drill")"

  # `check` fuerza el cambio de segmento y espera a que el WAL quede archivado.
  if (-not (Step "Archivar el WAL actual" { Compose exec -T backup pgbackrest check })) { Finish }
  if (-not (Step "Detener aplicación y base" { Compose stop web api worker backup postgres })) { Finish }

  $started = Get-Date
  if (-not (Step "Restaurar a $target" {
        Compose run --rm --no-deps --entrypoint pgbackrest -u postgres postgres --delta --type=time "--target=$target" --target-action=promote restore
      })) { Finish }
  if (-not (Step "Arrancar PostgreSQL restaurado" { Compose up -d --wait postgres })) { Finish }
  $seconds = [int]((Get-Date) - $started).TotalSeconds

  $rows = Psql "SELECT string_agg(label, ',' ORDER BY label) FROM restore_drill"
  Log "Filas después de restaurar: $rows (restauración en $seconds s)"
  if ($rows -eq "antes") {
    Log "OK    PITR: la fila anterior al destino está y la posterior no"
  } else {
    Log "FALLA PITR: se esperaba solo 'antes'"
    $script:failed = $true
  }
}

Finish
