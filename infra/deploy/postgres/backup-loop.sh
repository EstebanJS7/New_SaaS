#!/usr/bin/env bash
# Servicio de respaldos: prepara el repositorio de pgBackRest, toma un respaldo
# completo si no hay ninguno y después respalda una vez por día:
#   - completo el día BACKUP_FULL_WEEKDAY (1 = lunes ... 7 = domingo; por defecto 7)
#   - diferencial los demás días
# a la hora BACKUP_HOUR_UTC (por defecto 6 = 03:00 en Asunción).
#
# La retención la aplica pgBackRest (repo1-retention-full). El WAL se archiva
# en forma continua desde PostgreSQL (archive_command), así que la recuperación
# a un momento dado cubre todo el período retenido.
set -uo pipefail

FULL_DAY="${BACKUP_FULL_WEEKDAY:-7}"
HOUR="${BACKUP_HOUR_UTC:-6}"
MARKER=/tmp/pgbackrest/last-success

log() { echo "[backup $(date -u +%FT%TZ)] $*"; }

# DEC-093: avisa al monitor externo. Sin URL no hace nada; un fallo de red al
# avisar nunca detiene los respaldos.
heartbeat() {
  local suffix="$1"
  [[ -z "${BACKUP_HEARTBEAT_URL:-}" ]] && return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEARTBEAT_URL%/}${suffix}" \
    || log "ADVERTENCIA: no se pudo avisar al monitor de respaldos"
}

run_backup() {
  local type="$1"
  log "respaldo ${type}: inicio"
  if pgbackrest --type="$type" backup; then
    date -u +%s > "$MARKER"
    log "respaldo ${type}: OK"
    pgbackrest info
    # El respaldo no prueba que el WAL se siga archivando: check sí.
    if pgbackrest check; then
      heartbeat ""
    else
      log "respaldo ${type}: OK, pero el archivo continuo del WAL falla"
      heartbeat "/fail"
    fi
  else
    log "respaldo ${type}: FALLÓ"
    heartbeat "/fail"
  fi
}

log "esperando a PostgreSQL"
until pg_isready -q -h /var/run/postgresql; do sleep 2; done

# Idempotente: si el stanza ya existe y coincide con la base, no cambia nada.
until pgbackrest stanza-create; do
  log "stanza-create falló; reintento en 30 s"
  sleep 30
done

# Comprueba que archive_command funciona de punta a punta.
pgbackrest check || log "ADVERTENCIA: pgbackrest check falló (revisar archive_command)"

if ! pgbackrest info --output=json | grep -q '"label"'; then
  run_backup full
else
  log "ya existen respaldos en el repositorio"
  date -u +%s > "$MARKER"
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today ${HOUR}:00" +%s)
  if (( next <= now )); then next=$(date -u -d "tomorrow ${HOUR}:00" +%s); fi
  log "próximo respaldo: $(date -u -d "@${next}" +%FT%TZ)"
  sleep $(( next - now ))
  if [[ "$(date -u +%u)" == "$FULL_DAY" ]]; then run_backup full; else run_backup diff; fi
done
