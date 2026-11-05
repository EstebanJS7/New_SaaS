# Despliegue en un VPS único (piloto)

Este directorio despliega NewSaaS completo en **un solo servidor** con Docker
Compose. Es la opción elegida para validar con la primera clínica; cuando haya
varias clínicas pagas conviene pasar a una base de datos gestionada.

```text
Internet ──443──▶ Caddy ─┬─▶ web:3000  (Next.js: personal + portal, hace de BFF)
                         └─▶ api:3001  (solo recursos de marca del portal)
                web ──red interna──▶ api ──▶ postgres · redis · minio
                worker ─────────────────────▶ postgres · redis · minio
                backup ── pgBackRest ──▶ bucket S3 externo (cifrado)
```

| Archivo                              | Para qué                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `Dockerfile`                         | Una build del monorepo y cuatro targets: `api`, `worker`, `web`, `migrate` |
| `docker-compose.prod.yml`            | El stack completo; solo Caddy publica puertos                              |
| `Caddyfile`                          | HTTPS automático para `APP_DOMAIN` y `API_DOMAIN`                          |
| `env.production.example`             | Plantilla de variables; la real vive solo en el servidor                   |
| `deploy.sh`                          | Fija la etiqueta, migra, levanta y espera a que todo esté sano             |
| `restore.sh`                         | Restaura PostgreSQL desde pgBackRest (último estado o un momento dado)     |
| `postgres/`                          | Imagen de PostgreSQL 16 con pgBackRest y el servicio de respaldos          |
| `verify-local.ps1`                   | Prueba todo en Docker Desktop, incluido un ensayo de respaldo y PITR       |
| `../../.github/workflows/deploy.yml` | Construye imágenes en cada PR y despliega en cada push a `main`            |

El workflow vive por ahora en `deploy.workflow.yml`: moverlo a
`.github/workflows/deploy.yml` para activarlo.

## 0. Probar en tu computadora (Docker Desktop)

Antes del primer despliegue, desde la raíz del repositorio en PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File infra\deploy\verify-local.ps1
```

Construye las imágenes, levanta el stack con secretos de prueba (sin Caddy, web
en `localhost:18080` y API en `localhost:18081`), aplica las migraciones dos
veces, comprueba la salud de la API y la web, ensaya un respaldo con
recuperación a un momento dado y apaga todo. No toca el entorno de desarrollo.
El resultado queda en `infra/deploy/.verify/verify-local.log`. Con
`-KeepRunning` el stack queda levantado; con `-SkipBuild` reutiliza las imágenes
ya construidas; con `-SkipBackupDrill` omite el ensayo de respaldo.

## 1. Preparar el VPS (una vez)

Servidor recomendado: 4 vCPU, 8 GB de RAM, 80 GB de disco, Ubuntu 24.04.

```bash
# Usuario de despliegue, sin contraseña, solo con llave SSH
adduser --disabled-password --gecos "" deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh

# SSH solo con llave y sin root
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: solo SSH, HTTP y HTTPS
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable

# Actualizaciones automáticas de seguridad
apt-get update && apt-get install -y unattended-upgrades && dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Directorio del stack
mkdir -p /opt/newsaas && chown deploy:deploy /opt/newsaas
```

> Docker publica puertos por encima de `ufw`. Por eso el compose de producción
> no publica PostgreSQL, Redis ni MinIO: solo Caddy expone 80 y 443.

## 2. DNS

Dos registros `A` hacia la IP del VPS: `APP_DOMAIN` (por ejemplo
`app.tuclinica.com.py`) y `API_DOMAIN` (`api.tuclinica.com.py`). Caddy pide los
certificados la primera vez que arranca; los registros deben existir antes.

## 3. Variables de entorno (en el servidor)

```bash
cd /opt/newsaas
# copiar env.production.example desde el repositorio como env.production
chmod 600 env.production
nano env.production   # completar cada CAMBIAR
```

- Contraseñas: `openssl rand -hex 32` (solo hex, porque van dentro de URLs).
- `SECRET_STORE_MASTER_KEYS`: `echo "1:$(openssl rand -base64 32)"`. **Guardar
  una copia fuera del servidor**: sin ella no se descifra el material de firma
  SIFEN de los tenants.
- `FISCAL_PROVIDER`, `EMAIL_PROVIDER` y `WHATSAPP_PROVIDER` son obligatorios;
  `fake` es válido para staging. Compose se niega a arrancar si faltan.

## 4. Acceso a las imágenes (GHCR)

Las imágenes del repositorio privado también son privadas. En el VPS, como
`deploy`, iniciar sesión una vez con un token de GitHub de solo lectura
(`read:packages`):

```bash
echo "<TOKEN>" | docker login ghcr.io -u <usuario-github> --password-stdin
```

## 5. GitHub: environment `production`

En **Settings → Environments → New environment → `production`**:

- **Required reviewers**: vos. Cada despliegue espera tu aprobación.
- **Secrets**:
  - `VPS_HOST`: IP o nombre del servidor.
  - `VPS_USER`: `deploy`.
  - `VPS_SSH_KEY`: llave privada de un par creado solo para despliegues
    (`ssh-keygen -t ed25519 -f newsaas-deploy`); la pública va en
    `/home/deploy/.ssh/authorized_keys`.
  - `VPS_KNOWN_HOSTS`: salida de `ssh-keyscan <VPS_HOST>`.

## 6. Desplegar

- **Automático**: cada push a `main` construye y publica las imágenes; tras tu
  aprobación, el job `Deploy to VPS` copia los archivos y ejecuta `deploy.sh`.
- **A mano o para volver atrás**: en Actions → Deploy → Run workflow, con el sha
  de un commit ya publicado. En el servidor también sirve
  `bash /opt/newsaas/deploy.sh <sha>`.

Cada despliegue aplica las migraciones y carga los datos de referencia
(permisos, roles, impuestos) antes de reemplazar la API. El seed es idempotente
y **nunca** carga el demo.

## 7. Alta de una clínica

Las clínicas las crea el operador (no hay registro autoservicio). Un solo
comando crea la clínica, su primera sucursal, todas las funciones y el
propietario, y devuelve un enlace de activación de un solo uso que vale 72 h:

```bash
cd /opt/newsaas
docker compose -f docker-compose.prod.yml --env-file env.production run --rm migrate \
  pnpm exec tsx prisma/provision-tenant.ts \
    --slug san-roque --name "Veterinaria San Roque" \
    --owner-email duenia@sanroque.com.py --owner-name "María Pérez"
```

Opcionales: `--branch "Sucursal Centro"` (por defecto "Casa central") y
`--features veterinary,sales,...` (por defecto, todas). El slug es la dirección
del portal (`https://APP_DOMAIN/san-roque`). Mandale el enlace al propietario
por un canal privado; si vence, puede pedir otro desde "¿Olvidaste tu
contraseña?". Después, el propietario invita al resto del personal desde la
aplicación.

No usar `pnpm db:demo` en producción: se niega a correr fuera de
development/test.

## 8. Respaldos y recuperación (pgBackRest)

PostgreSQL archiva el WAL de forma continua (`archive_timeout=300`) y el
servicio `backup` toma un respaldo completo los domingos y uno diferencial los
demás días, a las 03:00 de Asunción. Todo va cifrado a un bucket S3 externo
(Backblaze B2, Cloudflare R2 u otro), en otro proveedor que el VPS. Con 4
completos retenidos se puede volver a cualquier momento de las últimas 4
semanas. Implementa los requisitos de `docs/09-operations/BACKUP-RECOVERY.md`.

Antes del primer despliegue:

1. Crear un bucket privado y una llave de acceso solo para ese bucket.
2. Completar `BACKUP_S3_*` y `BACKUP_CIPHER_PASS` en `env.production`.
3. **Guardar `BACKUP_CIPHER_PASS` y `SECRET_STORE_MASTER_KEYS` fuera del
   servidor** (gestor de contraseñas). Sin ellas los respaldos no sirven.

Ver el estado:

```bash
cd /opt/newsaas
docker compose -f docker-compose.prod.yml --env-file env.production exec backup pgbackrest info
docker compose -f docker-compose.prod.yml --env-file env.production ps backup   # healthy = respaldo de menos de 26 h
```

Restaurar (reemplaza los datos actuales; pide confirmación):

```bash
bash /opt/newsaas/restore.sh latest                      # tras perder el disco
bash /opt/newsaas/restore.sh "2026-11-05 14:30:00-03"    # a un momento dado
```

`verify-local.ps1` ensaya exactamente esto en cada corrida: respaldo completo,
dos escrituras, restauración al instante entre ambas y comprobación de que solo
sobrevive la primera. En el VPS conviene repetir el ensayo en staging y medir el
tiempo (RTO), que hoy no está medido.

## 9. Monitoreo y alertas (DEC-093)

Tres avisos, todos con planes gratuitos. Ninguno es obligatorio para arrancar;
sin configurar, simplemente no avisan.

**Caídas.** En UptimeRobot o Better Stack, dos monitores HTTP cada 5 minutos:

- `https://APP_DOMAIN/api/health/live`: el recorrido completo (Caddy, web y
  API).
- `https://API_DOMAIN/health/ready`: la API con su base de datos y Redis.

**Respaldos.** Crear un "heartbeat" (Healthchecks.io o Better Stack) con período
de 1 día y gracia de 2 horas, y poner su URL en `BACKUP_HEARTBEAT_URL`. El
servicio `backup` lo llama al terminar cada respaldo, y con `/fail` si el
respaldo falló o si el archivo continuo del WAL dejó de funcionar. Si un día no
llega ningún aviso, el monitor también alerta.

**Errores.** Crear un proyecto Node.js en Sentry y poner su DSN en `SENTRY_DSN`.
API, worker y web reportan solo errores inesperados (5xx, trabajos que agotaron
sus reintentos). Los eventos **no llevan** datos de la petición, cookies,
cabeceras, cuerpo, usuario ni variables; el mensaje se recorta a su primera
línea con correos y números enmascarados. Cada evento lleva el `requestId`, que
se busca en los logs de la API (`docker compose logs api | grep <requestId>`).

**Dirección del cliente.** Caddy entrega la dirección real del navegador; la web
la pasa a la API y la API solo la cree si viene de la red interna
(`API_TRUSTED_PROXIES`, 172.30.0.0/24). Así el límite de intentos de inicio de
sesión cuenta por persona y no por contenedor. El dominio de la API solo sirve
los recursos públicos de marca y la salud; el resto responde 404.

## Pendiente (no incluido todavía)

- **Errores del navegador**: hoy Sentry solo recibe errores del servidor.
- **Imagen más liviana**: el runtime copia el workspace con dependencias de
  desarrollo (más de 1 GB). Se puede podar con `pnpm deploy --prod` una vez que
  la imagen actual esté verificada.
