# PostgreSQL 16 con pgBackRest para respaldos y PITR (docs/09-operations/
# BACKUP-RECOVERY.md). La misma imagen corre como base de datos y como servicio
# `backup` (respaldos programados).
FROM postgres:16-bookworm

# La imagen oficial ya trae el repositorio apt de PostgreSQL (PGDG), que publica
# pgBackRest actualizado.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 750 /var/lib/pgbackrest /var/log/pgbackrest /tmp/pgbackrest

# Envoltorio con el mismo nombre, antes en el PATH: quita las variables
# PGBACKREST_* vacías que deja Compose, porque pgBackRest rechaza opciones sin
# valor.
COPY --chmod=755 pgbackrest-wrapper.sh /usr/local/bin/pgbackrest
COPY --chmod=755 backup-loop.sh /usr/local/bin/backup-loop.sh
