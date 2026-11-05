#!/usr/bin/env bash
# Restaura PostgreSQL desde el repositorio de pgBackRest, EN ESTE SERVIDOR.
#
#   bash /opt/newsaas/restore.sh latest
#       hasta el último WAL archivado (por ejemplo, tras perder el disco)
#   bash /opt/newsaas/restore.sh "2026-11-05 14:30:00-03"
#       a un momento dado (por ejemplo, antes de un borrado accidental)
#
# REEMPLAZA los datos actuales de la base. Detiene la aplicación mientras
# restaura y la vuelve a levantar al final. Antes de usarlo en producción,
# ensayarlo en staging: el tiempo que tarda es el RTO real.
set -euo pipefail

TARGET="${1:?uso: restore.sh latest | \"AAAA-MM-DD HH:MM:SS-03\"}"
cd /opt/newsaas
compose() { docker compose -f docker-compose.prod.yml --env-file env.production "$@"; }

echo "Respaldos disponibles:"
compose run --rm --no-deps --entrypoint pgbackrest -u postgres backup info

echo
echo "Se van a REEMPLAZAR los datos actuales de PostgreSQL. Destino: ${TARGET}"
read -r -p "Escribí RESTAURAR para continuar: " answer
[[ "$answer" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }

echo "Deteniendo la aplicación y la base..."
compose stop caddy web api worker backup postgres

args=(--delta)
if [[ "$TARGET" != "latest" ]]; then
  args+=(--type=time "--target=${TARGET}" --target-action=promote)
fi

echo "Restaurando..."
started=$(date +%s)
compose run --rm --no-deps --entrypoint pgbackrest -u postgres postgres "${args[@]}" restore

echo "Arrancando PostgreSQL (aplica el WAL hasta el destino)..."
compose up -d postgres
for _ in $(seq 1 120); do
  if compose exec -T postgres pg_isready -q; then break; fi
  sleep 5
done
compose exec -T postgres pg_isready
echo "Restauración lista en $(( $(date +%s) - started )) s."

echo "Levantando el resto del stack..."
compose up -d
echo "Listo. Verificá los datos y, si todo está bien, tomá un respaldo completo:"
echo "  docker compose -f docker-compose.prod.yml --env-file env.production exec -u postgres backup pgbackrest --type=full backup"
