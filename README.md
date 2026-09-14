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

## Puesta en marcha rápida

Secuencia para un clon limpio, ejecutada desde la raíz del repositorio:

```bash
# 1. Copiar la plantilla de entorno versionada a .env (marcadores de posición)
cp .env.example .env

# 2. Instalar dependencias (el postinstall de @newsaas/database genera Prisma)
pnpm install

# 3. Levantar PostgreSQL y Redis locales
pnpm services:up

# 4. Compilar el workspace; preflight requiere packages/preflight/dist/cli.js
pnpm build

# 5. Comprobar que los servicios responden
pnpm preflight

# 6. Aplicar las migraciones a la base local
pnpm --filter @newsaas/database db:migrate

# 7. Iniciar API, worker y web en modo desarrollo
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
(`ENABLE_DEMO_SEED=false` en la plantilla `.env.example`). Para cargar el tenant
de demostración, definir `ENABLE_DEMO_SEED=true` antes de ejecutar `db:seed`.

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
