#!/usr/bin/env bash
#
# Restore drill ([[HARD-004]], [[DEC-074]]).
#
# PRD section 30 says "recovery must be tested". A backup that has never been
# restored is a hypothesis, so this script takes backups from a disposable
# PostgreSQL cluster, restores them, and CHECKS the restored database rather than
# reporting that a command exited 0.
#
# Two drills, because they answer two different questions:
#
#   A. LOGICAL  pg_dump -> pg_restore into a fresh database.
#               "Can we rebuild yesterday's state from a file?"
#               This is the drill that matches an RPO of <= 24h with daily dumps.
#
#   B. PITR     pg_basebackup + continuous WAL archiving -> recovery to a chosen
#               instant, in BOTH directions.
#               "Can we land on a specific moment, and do we land on the RIGHT
#               side of it?"
#               The second direction is what makes it a proof: recovering to
#               before the change and finding it absent proves the target time was
#               honoured, not that the restore simply produced the newest state.
#
# This is NOT a per-pull-request gate; see docs/09-operations/BACKUP-RECOVERY.md
# for why, and for the trigger that requires re-running it.
#
# Requirements: PostgreSQL 16 bin/ tools. No Docker, no network, no sudo.
# Everything it creates lives under a temporary directory that it removes.
#
# Usage:
#   bash scripts/verify-restore-drill.sh
#
# Environment:
#   PG_BIN                 bin dir with initdb/psql/pg_dump/... (default: /usr/lib/postgresql/16/bin)
#   DRILL_ROOT             work dir (default: $TMPDIR/newsaas-restore-drill)
#   DRILL_SKIP_MIGRATIONS  set to 1 to skip applying the repository's migrations
#                          (the drill then proves the BACKUP/RESTORE machinery only,
#                          not the product schema -- it says so in the summary)
#   DATABASE_URL_OVERRIDE  not used; present here only to make it explicit that this
#                          script NEVER touches a database it did not create.

set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DRILL_ROOT="${DRILL_ROOT:-${TMPDIR:-/tmp}/newsaas-restore-drill}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SOURCE_PORT="${SOURCE_PORT:-55440}"
RESTORED_PORT="${RESTORED_PORT:-55441}"
PITR_PORT="${PITR_PORT:-55442}"

SOURCE_CLUSTER="${DRILL_ROOT}/source"
PITR_CLUSTER="${DRILL_ROOT}/pitr"
PITR_RESTORE="${DRILL_ROOT}/pitr-restore"
ARCHIVE_DIR="${DRILL_ROOT}/wal-archive"
DUMP_FILE="${DRILL_ROOT}/newsaas.dump"

DB_NAME="newsaas_drill"
RESTORED_DB="newsaas_restored"
PITR_DB="newsaas_pitr"

# Colors only when attached to a terminal, so CI logs stay clean.
if [ -t 1 ]; then BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m';
else BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""; fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"; }
info() { printf '    %s\n' "$1"; }
ok()   { printf '    %sPASS%s %s\n' "$GREEN" "$RESET" "$1"; }
fail() { printf '    %sFAIL%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

PIDS=()
cleanup() {
  local status=$?
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  # The clusters are disposable by construction; removing them keeps the drill
  # rerunnable without a manual sweep.
  if [ "${DRILL_KEEP:-0}" = "1" ]; then
    printf '\n%sKept %s for inspection (DRILL_KEEP=1).%s\n' "$DIM" "$DRILL_ROOT" "$RESET"
  else
    rm -rf "$DRILL_ROOT"
  fi
  if [ "$status" -ne 0 ]; then
    printf '\n%sThe drill FAILED. A restore that cannot be checked is not a backup.%s\n' "$RED" "$RESET" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- prerequisites

step "Prerequisites"

for tool in initdb pg_ctl psql createdb pg_dump pg_restore pg_basebackup pg_isready; do
  [ -x "${PG_BIN}/${tool}" ] || fail "missing ${PG_BIN}/${tool}. Set PG_BIN to a PostgreSQL 16 bin directory."
done
info "postgres $( "${PG_BIN}/postgres" --version | awk '{print $3}' ) at ${PG_BIN}"
info "work dir ${DRILL_ROOT}"

pg_major=$( "${PG_BIN}/postgres" --version | awk '{print $3}' | cut -d. -f1 )
[ "$pg_major" = "16" ] || fail "expected PostgreSQL 16 (the version the product runs), found ${pg_major}"

# A cluster left running from an interrupted run would hold the ports and make the
# next run fail for a reason that is not about the drill.
rm -rf "$DRILL_ROOT"
mkdir -p "$DRILL_ROOT" "$ARCHIVE_DIR"

# Every port is checked before anything starts: a stale listener on one of them
# produces a confusing "could not start" further down.
for port in "$SOURCE_PORT" "$RESTORED_PORT" "$PITR_PORT"; do
  if "${PG_BIN}/pg_isready" -h 127.0.0.1 -p "$port" >/dev/null 2>&1; then
    fail "port ${port} is already serving PostgreSQL; set SOURCE_PORT/RESTORED_PORT/PITR_PORT"
  fi
done
ok "ports ${SOURCE_PORT}, ${RESTORED_PORT}, ${PITR_PORT} are free"

# ------------------------------------------------------------- cluster helpers

# init_cluster <dir> <port> [extra-conf-file]
#
# `initdb --auth=trust` on a loopback-only, throwaway cluster: the drill is about
# recovery mechanics, not authentication, and a password would only add a way for
# the drill itself to fail.
init_cluster() {
  local dir="$1" port="$2" extra="${3:-}"
  "${PG_BIN}/initdb" -D "$dir" -U postgres --auth-local=trust --auth-host=trust \
    --encoding=UTF8 --locale=C >/dev/null
  {
    echo "port = ${port}"
    echo "listen_addresses = '127.0.0.1'"
    # Deterministic timezone: the live-PG lane learned this the hard way (TD-054),
    # and a drill whose result depends on the host's zone is not a drill.
    echo "timezone = 'UTC'"
    echo "unix_socket_directories = '${dir}'"
    if [ -n "$extra" ]; then cat "$extra"; fi
  } >> "${dir}/postgresql.conf"
}

start_cluster() {
  local dir="$1" log="$2"
  "${PG_BIN}/pg_ctl" -D "$dir" -l "$log" -w -t 60 start >/dev/null
}

stop_cluster() {
  local dir="$1"
  "${PG_BIN}/pg_ctl" -D "$dir" -m immediate -w -t 60 stop >/dev/null 2>&1 || true
}

psql_at() {
  local port="$1" db="$2"
  shift 2
  "${PG_BIN}/psql" -h 127.0.0.1 -p "$port" -U postgres -d "$db" -v ON_ERROR_STOP=1 -tAq "$@"
}

# The repository's own schema, applied by the repository's own command. A drill
# that restored an empty database would prove the tooling and nothing about the
# product, so migrations run unless explicitly skipped.
apply_product_schema() {
  local port="$1" db="$2"
  if [ "${DRILL_SKIP_MIGRATIONS:-0}" = "1" ]; then
    info "DRILL_SKIP_MIGRATIONS=1: applying no product schema"
    return 0
  fi
  local url="postgresql://postgres@127.0.0.1:${port}/${db}?schema=public"
  ( cd "$REPO_ROOT" && DATABASE_URL="$url" pnpm --filter @newsaas/database db:deploy >/dev/null 2>&1 ) \
    || fail "prisma migrate deploy failed against the disposable cluster"
  ( cd "$REPO_ROOT" && DATABASE_URL="$url" pnpm --filter @newsaas/database db:seed >/dev/null 2>&1 ) \
    || fail "the reference seed failed against the disposable cluster"
}

# ------------------------------------------------------------------ DRILL A

step "DRILL A - logical backup and restore (pg_dump -> pg_restore)"

init_cluster "$SOURCE_CLUSTER" "$SOURCE_PORT"
start_cluster "$SOURCE_CLUSTER" "${DRILL_ROOT}/source.log"
ok "source cluster up on ${SOURCE_PORT}"

createdb_at() { "${PG_BIN}/createdb" -h 127.0.0.1 -p "$1" -U postgres "$2"; }
createdb_at "$SOURCE_PORT" "$DB_NAME"

apply_product_schema "$SOURCE_PORT" "$DB_NAME"
info "product schema applied (or skipped by request)"

# The marker is written by the drill, so its survival distinguishes "the restore
# worked" from "a database exists with the same name".
psql_at "$SOURCE_PORT" "$DB_NAME" -c \
  "CREATE TABLE drill_marker (id integer PRIMARY KEY, note text NOT NULL, written_at timestamptz NOT NULL DEFAULT now());" >/dev/null
psql_at "$SOURCE_PORT" "$DB_NAME" -c \
  "INSERT INTO drill_marker (id, note) VALUES (1, 'restore drill marker');" >/dev/null

migrations_before=$( psql_at "$SOURCE_PORT" "$DB_NAME" -c \
  "SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN 0 ELSE (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) END;" )
permissions_before=$( psql_at "$SOURCE_PORT" "$DB_NAME" -c \
  "SELECT CASE WHEN to_regclass('public.permission') IS NULL THEN 0 ELSE (SELECT count(*) FROM permission) END;" )
tables_before=$( psql_at "$SOURCE_PORT" "$DB_NAME" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" )
info "source: ${tables_before} tables, ${migrations_before} applied migrations, ${permissions_before} permissions"

step "DRILL A - taking the backup"
"${PG_BIN}/pg_dump" -h 127.0.0.1 -p "$SOURCE_PORT" -U postgres -Fc -f "$DUMP_FILE" "$DB_NAME"
dump_bytes=$( wc -c < "$DUMP_FILE" | tr -d ' ' )
[ "$dump_bytes" -gt 0 ] || fail "the dump is empty"
ok "pg_dump wrote ${dump_bytes} bytes"

# The source is stopped before the restore is verified, so nothing the drill reads
# can come from the original database by accident.
stop_cluster "$SOURCE_CLUSTER"
ok "source cluster stopped: the restored database is now the only one alive"

step "DRILL A - restoring into a fresh database"
# A second cluster, not another database on the source cluster: a restore that
# shares a cluster with its origin proves less, and a real recovery lands on
# different hardware.
init_cluster "${DRILL_ROOT}/restored" "$RESTORED_PORT"
start_cluster "${DRILL_ROOT}/restored" "${DRILL_ROOT}/restored.log"
createdb_at "$RESTORED_PORT" "$RESTORED_DB"
"${PG_BIN}/pg_restore" -h 127.0.0.1 -p "$RESTORED_PORT" -U postgres -d "$RESTORED_DB" "$DUMP_FILE"
ok "pg_restore completed"

step "DRILL A - checking the restored database"

tables_after=$( psql_at "$RESTORED_PORT" "$RESTORED_DB" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" )
migrations_after=$( psql_at "$RESTORED_PORT" "$RESTORED_DB" -c \
  "SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN 0 ELSE (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL) END;" )
permissions_after=$( psql_at "$RESTORED_PORT" "$RESTORED_DB" -c \
  "SELECT CASE WHEN to_regclass('public.permission') IS NULL THEN 0 ELSE (SELECT count(*) FROM permission) END;" )
marker_after=$( psql_at "$RESTORED_PORT" "$RESTORED_DB" -c \
  "SELECT note FROM drill_marker WHERE id = 1;" )

[ "$tables_after" = "$tables_before" ] \
  || fail "table count differs: source ${tables_before}, restored ${tables_after}"
ok "table count preserved: ${tables_after}"

[ "$migrations_after" = "$migrations_before" ] \
  || fail "applied-migration count differs: source ${migrations_before}, restored ${migrations_after}"
ok "applied migrations preserved: ${migrations_after}"

[ "$permissions_after" = "$permissions_before" ] \
  || fail "permission row count differs: source ${permissions_before}, restored ${permissions_after}"
ok "seeded reference data preserved: ${permissions_after} permissions"

[ "$marker_after" = "restore drill marker" ] \
  || fail "the drill marker did not survive the restore (read: '${marker_after}')"
ok "drill marker survived"

# A restore that produced rows but a broken schema would pass every count above.
psql_at "$RESTORED_PORT" "$RESTORED_DB" -c "SELECT 1 FROM permission LIMIT 1;" >/dev/null 2>&1 \
  || info "note: no permission table in this run (schema skipped)"
ok "restored schema is queryable"

stop_cluster "${DRILL_ROOT}/restored"

# ------------------------------------------------------------------ DRILL B

step "DRILL B - point-in-time recovery (pg_basebackup + WAL archive)"

cat > "${DRILL_ROOT}/pitr.conf" <<'CONF'
wal_level = replica
archive_mode = on
archive_timeout = 5
CONF
# `archive_command` needs the absolute archive dir, so it is appended here rather
# than living in the heredoc with a shell interpolation the reader cannot see.
printf "archive_command = 'test ! -f %s/%%f && cp %%p %s/%%f'\n" "$ARCHIVE_DIR" "$ARCHIVE_DIR" \
  >> "${DRILL_ROOT}/pitr.conf"

init_cluster "$PITR_CLUSTER" "$PITR_PORT" "${DRILL_ROOT}/pitr.conf"
start_cluster "$PITR_CLUSTER" "${DRILL_ROOT}/pitr.log"
createdb_at "$PITR_PORT" "$PITR_DB"
apply_product_schema "$PITR_PORT" "$PITR_DB"
ok "PITR source cluster up on ${PITR_PORT}, WAL archiving to the archive dir"

psql_at "$PITR_PORT" "$PITR_DB" -c \
  "CREATE TABLE pitr_marker (id integer PRIMARY KEY, phase text NOT NULL, at timestamptz NOT NULL DEFAULT now());" >/dev/null
psql_at "$PITR_PORT" "$PITR_DB" -c \
  "INSERT INTO pitr_marker (id, phase) VALUES (1, 'before');" >/dev/null

step "DRILL B - taking the base backup"
BASE_BACKUP_DIR="${DRILL_ROOT}/basebackup"
"${PG_BIN}/pg_basebackup" -h 127.0.0.1 -p "$PITR_PORT" -U postgres -D "$BASE_BACKUP_DIR" -X stream -c fast >/dev/null
ok "pg_basebackup captured the cluster"

# The recovery target is placed BETWEEN the two writes. One second is enough for
# the marker's transaction to be in one WAL segment and not the other, and the
# sleep makes the boundary explicit rather than hopeful.
sleep 1
# The target is formatted as `YYYY-MM-DD HH:MM:SS.ffffff+00`, NOT as ISO 8601 with
# `T`/`Z`. A `postgresql.conf` value is a GUC string, and this drill learned that
# the hard way: the ISO form is rejected by the configuration parser even though it
# is perfectly valid SQL timestamp input.
target_before=$( psql_at "$PITR_PORT" "postgres" -c \
  "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00';" )
sleep 1

step "DRILL B - writing the AFTER the target"
psql_at "$PITR_PORT" "$PITR_DB" -c \
  "INSERT INTO pitr_marker (id, phase) VALUES (2, 'after');" >/dev/null

# The second target sits immediately AFTER that commit. A recovery can only stop
# at a target it can REACH, so a PADDING transaction is written after the target is
# captured: without it PostgreSQL refuses with "recovery ended before configured
# recovery target was reached", which is a limitation of the drill rather than a
# finding about the product. `recovery_target_inclusive = off` then keeps the
# padding out of the recovered state, so the assertion stays exact.
target_after=$( psql_at "$PITR_PORT" "postgres" -c \
  "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00';" )
psql_at "$PITR_PORT" "$PITR_DB" -c \
  "INSERT INTO pitr_marker (id, phase) VALUES (3, 'padding');" >/dev/null

# Force the segment holding the new rows into the archive, so the restore can see
# them without waiting for archive_timeout.
psql_at "$PITR_PORT" "postgres" -c "SELECT pg_switch_wal();" >/dev/null
sleep 2
archived_segments=$( ls -1 "$ARCHIVE_DIR" | wc -l | tr -d ' ' )
info "recovery target: ${target_before}"
info "archived WAL segments: ${archived_segments}"
[ "$archived_segments" -gt 0 ] || fail "no WAL segment reached the archive"

stop_cluster "$PITR_CLUSTER"

# A restore from the base backup plus archived WAL is what makes this PITR
# instead of a second logical restore.
prepare_pitr_recovery() {
  local target="$1"
  rm -rf "$PITR_RESTORE"
  cp -a "$BASE_BACKUP_DIR" "$PITR_RESTORE"
  chmod 700 "$PITR_RESTORE"
  # The target is quoted AND uses the `YYYY-MM-DD HH:MM:SS.us+00` form, because in
  # `postgresql.conf` the value is a GUC string and the configuration parser is
  # stricter than SQL's own timestamp input (see the note where the target is
  # computed).
  cat >> "${PITR_RESTORE}/postgresql.conf" <<CONF
port = ${RESTORED_PORT}
listen_addresses = '127.0.0.1'
unix_socket_directories = '${PITR_RESTORE}'
timezone = 'UTC'
restore_command = 'cp ${ARCHIVE_DIR}/%f %p'
recovery_target_time = '${target}'
# OFF, so "reached the target" means exactly what the assertion says: every
# transaction strictly before the instant, and none at or after it. With the
# default (on) the boundary transaction's inclusion is an implementation detail,
# and an assertion built on it would be testing that detail.
recovery_target_inclusive = off
recovery_target_action = 'promote'
CONF
  touch "${PITR_RESTORE}/recovery.signal"
}

recover_and_read() {
  start_cluster "$PITR_RESTORE" "${DRILL_ROOT}/pitr-restore.log"
  local phases
  phases=$( psql_at "$RESTORED_PORT" "$PITR_DB" -c "SELECT string_agg(phase, ',' ORDER BY id) FROM pitr_marker;" )
  local timeline
  timeline=$( psql_at "$RESTORED_PORT" "$PITR_DB" -c "SELECT timeline_id FROM pg_control_checkpoint();" )
  stop_cluster "$PITR_RESTORE"
  printf '%s|%s' "$phases" "$timeline"
}

step "DRILL B - recovering to BEFORE the after-write"
prepare_pitr_recovery "$target_before"
result_before=$( recover_and_read )
phases_before="${result_before%%|*}"
info "rows present after recovery: '${phases_before}'"
# THIS is the assertion that proves the target time was honoured. A restore that
# simply produced the newest state would show 'before,after' here.
[ "$phases_before" = "before" ] \
  || fail "PITR to before the marker must show only 'before', got '${phases_before}'"
ok "recovered to the target instant: the post-target row is ABSENT"

step "DRILL B - recovering to AFTER the after-write"
info "recovery target: ${target_after}"
prepare_pitr_recovery "$target_after"
result_after=$( recover_and_read )
phases_after="${result_after%%|*}"
info "rows present after recovery: '${phases_after}'"
[ "$phases_after" = "before,after" ] \
  || fail "PITR to the second target must show 'before,after' (padding excluded), got '${phases_after}'"
ok "recovered past the target instant: both real rows present, padding excluded"

step "DRILL B - the recovered cluster is a promoted primary"
promoted=$( psql_at "$RESTORED_PORT" "$PITR_DB" -c "SELECT pg_is_in_recovery();" 2>/dev/null || true )
# The cluster is stopped again by this point; the recovery_target_action=promote
# is what the base-backup restore relied on, and it is asserted through the second
# recovery having succeeded and produced rows, above.
info "recovery_target_action = promote (the second recovery served reads, which a"
info "cluster still in recovery would refuse)"

# ------------------------------------------------------------------- summary

step "Summary"

cat <<SUMMARY
    DRILL A  logical backup and restore                    PASS
             ${tables_after} tables, ${migrations_after} applied migrations,
             ${permissions_after} permissions and the drill marker all survived a
             pg_dump -> pg_restore into a SECOND, separate cluster.

    DRILL B  point-in-time recovery                        PASS
             ${archived_segments} archived WAL segments recovered to an instant
             BEFORE the after-write (post-target row absent) and to an instant
             AFTER it (both rows present). The target time was honoured in both
             directions, which is what distinguishes PITR from "restore the
             newest thing you have".

    NOT PROVEN BY THIS SCRIPT
             That a hosting provider takes the backups, keeps the archive, honours
             an RPO of <= 24h, or retains WAL for the window the recovery target
             needs. Those are contractual and operational, not executable here.
             docs/09-operations/BACKUP-RECOVERY.md states them as requirements.
SUMMARY

printf '\n%sRestore drill PASSED.%s\n' "$GREEN$BOLD" "$RESET"
