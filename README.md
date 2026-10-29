# NewSaaS

Plataforma SaaS multi-tenant, modular y reutilizable para gestión de negocios,
con un Core de negocio compartido y una vertical veterinaria. El backend expone
una API REST (NestJS + Fastify + Prisma + PostgreSQL) y el frontend es una
aplicación Next.js + React + TypeScript + Tailwind + shadcn/ui; Redis + BullMQ
se usan para trabajo asíncrono.

Este README describe cómo poner en marcha el proyecto localmente. El alcance de
producto aprobado vive en el PRD y en la documentación enlazada más abajo; este
documento no lo repite ni lo modifica.

## Requisitos previos

- Node.js 22 o superior (`engines.node` en `package.json`).
- pnpm 11 o superior (`packageManager` en `package.json`).
- Docker y Docker Compose para los servicios locales.
- Git.

En Windows se verificó Node **22.23.4** con datos de zona horaria **2026e**.
Node 22.14.0 trae datos antiguos y calcula incorrectamente fechas de 2026 en
`America/Asuncion`. Usá una versión 22 LTS actualizada; si cambiás de versión
mayor, reinstalá las dependencias nativas antes de arrancar el proyecto
(`libxmljs2` de este checkout está compilado para Node 22). Ver
[TD-064](docs/08-tech-debt/TD-064-windows-verification-environment.md).

## Puesta en marcha rápida

Secuencia para un clon limpio, ejecutada desde la raíz del repositorio:

```bash
# 1. Copiar la plantilla de entorno versionada a .env (marcadores de posición)
cp .env.example .env

# 2. Instalar dependencias (el postinstall de @newsaas/database genera Prisma)
pnpm install

# 3. Levantar PostgreSQL, Redis y MinIO locales
pnpm services:up

# 4. Compilar el workspace; preflight requiere packages/preflight/dist/cli.js
pnpm build

# 5. Comprobar que los servicios responden
pnpm preflight

# 6. Aplicar las migraciones a la base local
export DATABASE_URL="$(node --env-file=.env -p 'process.env.DATABASE_URL')"
pnpm --filter @newsaas/database db:deploy

# 7. Cargar datos de referencia y demo (solo desarrollo/test)
pnpm db:demo

# 8. Iniciar API, worker y web en modo desarrollo
pnpm dev
```

La aplicación web queda disponible en `http://localhost:3000`. La base local no
tiene tablas hasta aplicar las migraciones del paso 6, por lo que no conviene
operar la aplicación antes de ese paso. Para detener los servicios locales:

```bash
pnpm services:down
```

`pnpm services:reset` elimina además los volúmenes locales de datos.

No se deben confirmar credenciales reales en el repositorio. `.env.example` es
la plantilla de entorno versionada y segura que se copia a `.env`; no es la
única fuente de valores de ejecución: los valores reales se resuelven desde
`.env` (fuera del control de versiones) y pueden sobrescribirse con variables de
entorno exportadas.

## Servicios y puertos

| Servicio             | Puerto por defecto | Variable        |
| -------------------- | ------------------ | --------------- |
| Web (Next.js)        | `3000`             | —               |
| API (NestJS/Fastify) | `3001`             | `API_PORT`      |
| PostgreSQL 16        | `5432`             | `POSTGRES_PORT` |
| Redis 7              | `6379`             | `REDIS_PORT`    |
| Worker (BullMQ)      | sin puerto         | —               |

Los puertos se pueden ajustar en `.env`; `docker-compose.yml` los toma de las
mismas variables.

## Base de datos

Los comandos de esquema, migraciones y datos se ejecutan en el paquete
`@newsaas/database`:

```bash
# Crear/aplicar migraciones en desarrollo
pnpm --filter @newsaas/database db:migrate

# Aplicar migraciones existentes (entornos desplegados)
pnpm --filter @newsaas/database db:deploy

# Cargar datos de referencia
pnpm --filter @newsaas/database db:seed

# Verificar migraciones contra una base PostgreSQL real
pnpm --filter @newsaas/database db:live-verify
```

El seed de datos de demostración está desactivado por defecto
(`ENABLE_DEMO_SEED=false` en la plantilla `.env.example`). `db:seed` carga solo
datos de referencia. El comando raíz `pnpm db:demo` carga `.env`, compila la
API, ejecuta ambos seeds y agrega ejemplos comerciales. Invocarlo es el opt-in
explícito; rechaza cualquier `NODE_ENV` distinto de `development`/`test` y
proveedores fiscales, de email o WhatsApp reales.

## Desarrollo local con Docker Desktop y PowerShell

Docker Desktop ejecuta PostgreSQL, Redis y MinIO; Node ejecuta web, API y
worker. Crear `.env` una sola vez sin sobrescribir uno existente:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Para archivos compartidos entre API y worker, completar el `.env` local:

```dotenv
STORAGE_S3_BUCKET=newsaas-imports
STORAGE_S3_REGION=us-east-1
STORAGE_S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=newsaas
AWS_SECRET_ACCESS_KEY=newsaas-minio-secret
```

Primera ejecución, desde la raíz (Node 22+ y pnpm 11.1.2):

```powershell
pnpm install
docker compose up -d
# Esperar a que docker compose ps muestre los servicios healthy.
$env:DATABASE_URL = node --env-file=.env -p "process.env.DATABASE_URL"
pnpm --filter @newsaas/database db:deploy
pnpm db:demo
pnpm dev
```

Si PostgreSQL de Windows ya ocupa `5432`, usar `POSTGRES_PORT=5433` y
`DATABASE_URL=postgresql://newsaas:newsaas@127.0.0.1:5433/newsaas?schema=public`
en `.env`. Actualizar también cualquier variable de esa terminal que tenga el
valor anterior: las variables exportadas tienen prioridad sobre `.env`.

Ingresar en `http://localhost:3000/login` con `owner@demo.newsaas.test` /
`demo-owner-password`. Portal: `http://localhost:3000/demo/login`,
`ana.garcia@demo.newsaas.test` / `demo-portal-password`.

En los siguientes arranques basta con `docker compose up -d` y `pnpm dev`.
Detener las terminales anteriores de API/worker/web antes de usar el comando
único. `pnpm dev` carga el `.env` raíz, compila las dependencias de backend y
arranca los tres procesos; API y worker recompilan con TypeScript y reinician
después de guardar cambios válidos. Los errores de tipos mantienen el último
proceso válido. Cambios en paquetes compartidos requieren volver a ejecutar
`pnpm dev`. Cambios en `.env` también requieren reiniciar.

### Datos del demo comercial

El demo base conserva sus clientes, pacientes y fechas fijas de agenda. El demo
comercial agrega cuatro artículos identificados con `· DEMO`, un proveedor, una
compra recibida y:

- stock inicial: alimento 20, vacuna 30 e insumo 50 unidades;
- una venta de consulta más alimento por PYG 185.000, pagada con efectivo
  (100.000) y tarjeta (85.000); quedan 19 unidades de alimento;
- una venta borrador con dos insumos;
- una caja histórica cerrada: apertura 200.000, ingreso de venta 100.000, cierre
  esperado/contado 300.000, diferencia cero;
- una caja de práctica abierta con fondo inicial de 150.000.

Las operaciones pasan por los servicios existentes y generan su auditoría; el
seed no modifica saldos ni registros confirmados directamente. Las fechas
comerciales corresponden a la primera ejecución. No crea facturas ni envía
documentos fiscales. No borra datos. Al repetirlo reconoce los ejemplos por sus
nombres y relaciones, y conserva sus estados; esos nombres están reservados para
el seed. Renombrar/eliminar sus referencias puede impedir su reconocimiento. Una
caja ajena al demo abierta hace rechazar el seed, sin cerrarla. El seed base
vuelve a establecer las contraseñas demo conocidas.

Comprobaciones específicas, después de cargar el demo:

```powershell
pnpm test:dev
pnpm test:demo
```

La primera verifica metadatos, reinicio y rechazo de errores de tipos. La
segunda ejecuta dos veces el seed comercial y comprueba ausencia de nuevas
filas, aislamiento, igualdad entre stock y ledger, pago mixto y cierre de caja.

## Comandos de calidad

```bash
pnpm lint          # ESLint en todo el workspace
pnpm format-check  # Verificación de formato con Prettier
pnpm typecheck     # Tipos en todos los paquetes
pnpm test          # Pruebas unitarias y de integración
pnpm build         # Build de todo el workspace
```

## Estructura del repositorio

```text
apps/                 Aplicaciones: api, web, worker
packages/             Paquetes compartidos: database, shared, ui, config,
                      storage, eslint-config, prettier-config,
                      typescript-config, vitest-config, preflight
docs/                 Vault de documentación (producto, roadmap, stories,
                      arquitectura, ADRs, módulos, deuda, releases, QA,
                      gobernanza, plantillas)
openspec/             Propuestas SDD activas, specs y cambios archivados
infra/scripts/        Scripts de preflight (bash y PowerShell)
docker-compose.yml    Servicios locales (PostgreSQL y Redis)
AGENTS.md             Reglas de trabajo para agentes y contribuyentes
```

## Fuentes autoritativas

- Reglas de ingeniería:
  [`docs/99-governance/ENGINEERING-RULES.md`](docs/99-governance/ENGINEERING-RULES.md)
- Reglas de documentación:
  [`docs/99-governance/DOCUMENTATION-RULES.md`](docs/99-governance/DOCUMENTATION-RULES.md)
- PRD (alcance aprobado): [`docs/00-product/PRD.md`](docs/00-product/PRD.md)
- Roadmap de épicas: [`docs/01-roadmap/ROADMAP.md`](docs/01-roadmap/ROADMAP.md)
- Arquitectura:
  [`docs/03-architecture/OVERVIEW.md`](docs/03-architecture/OVERVIEW.md)
- ADRs: [`docs/04-adrs/README.md`](docs/04-adrs/README.md)
- Módulos implementados:
  [`docs/05-modules/README.md`](docs/05-modules/README.md)
- Evidencia de CI: [`docs/10-qa/CI-EVIDENCE.md`](docs/10-qa/CI-EVIDENCE.md)
- Índice del vault de documentación: [`docs/README.md`](docs/README.md)
- Guía para agentes: [`AGENTS.md`](AGENTS.md)

## Licencia

Proyecto privado sin licencia de distribución (`UNLICENSED` en `package.json`).
El uso externo requiere autorización explícita.
