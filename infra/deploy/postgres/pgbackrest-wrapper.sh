#!/bin/sh
# Llama a pgBackRest sin las variables PGBACKREST_* vacías (Compose las define
# vacías cuando un valor opcional no está en el archivo de entorno).
for name in $(env | sed -n 's/^\(PGBACKREST_[A-Z0-9_]*\)=$/\1/p'); do
  unset "$name"
done
exec /usr/bin/pgbackrest "$@"
