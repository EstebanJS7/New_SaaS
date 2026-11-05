#!/usr/bin/env bash
# Despliega una etiqueta de imagen en el VPS. Lo invoca el workflow Deploy por
# SSH, y también se puede correr a mano para volver a una versión anterior:
#
#   bash /opt/newsaas/deploy.sh <sha>
set -euo pipefail

TAG="${1:?uso: deploy.sh <etiqueta-de-imagen>}"
cd /opt/newsaas

if [[ ! -f env.production ]]; then
  echo "Falta /opt/newsaas/env.production (ver env.production.example)." >&2
  exit 1
fi

# Fija la etiqueta en el archivo de entorno: así un reinicio del servidor vuelve
# a levantar la misma versión.
if grep -q '^IMAGE_TAG=' env.production; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" env.production
else
  echo "IMAGE_TAG=${TAG}" >> env.production
fi

compose() { docker compose -f docker-compose.prod.yml --env-file env.production "$@"; }

compose pull --quiet
# Migraciones + datos de referencia antes de reemplazar la API y el worker.
compose up -d postgres redis minio
compose run --rm migrate
compose up -d --remove-orphans

echo "Esperando a que la API y la web respondan..."
for _ in $(seq 1 30); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)")" == healthy \
     && "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q web)")" == healthy ]]; then
    echo "Desplegado ${TAG}."
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "La API o la web no quedaron sanas en 150 s. Logs recientes:" >&2
compose logs --tail=80 api web worker >&2
exit 1
