# syntax=docker/dockerfile:1.7
#
# Imagen de producción de NewSaaS: una sola build del monorepo y tres targets
# de ejecución (api, worker, web) más uno de migraciones (migrate).
#
#   docker build -f infra/deploy/Dockerfile --target api    -t newsaas-api .
#   docker build -f infra/deploy/Dockerfile --target worker -t newsaas-worker .
#   docker build -f infra/deploy/Dockerfile --target web    -t newsaas-web .
#   docker build -f infra/deploy/Dockerfile --target migrate -t newsaas-migrate .
#
# Node se fija a la versión exacta verificada en el README (22.23.4, tzdata
# 2026e). Una versión con datos de zona horaria viejos calcula mal las fechas de
# America/Asuncion (TD-064, TD-072), así que NO se usa una etiqueta flotante.
ARG NODE_VERSION=22.23.4
ARG PNPM_VERSION=11.1.2

# ---------------------------------------------------------------------------
# base: Node + pnpm + librerías del sistema que necesitan Prisma y argon2.
# Debian (glibc) en lugar de Alpine: argon2 y los motores de Prisma cargan
# binarios precompilados para glibc.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION} \
 && pnpm --version
WORKDIR /app

# ---------------------------------------------------------------------------
# build: instala todas las dependencias y compila api, worker y web.
# ---------------------------------------------------------------------------
FROM base AS build
# 1) Descarga de paquetes solo a partir del lockfile: esta capa queda en caché
#    mientras pnpm-lock.yaml no cambie.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm fetch --frozen-lockfile

# 2) Código fuente e instalación offline (el postinstall de @newsaas/database
#    ejecuta `prisma generate`).
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --offline

# 3) Build. La web hace de BFF: sus rutas de servidor llaman a la API por la red
#    interna de Docker. Next.js inyecta NEXT_PUBLIC_API_URL en tiempo de build
#    (next.config.js -> env), así que el valor se fija acá y no en runtime.
ARG NEXT_PUBLIC_API_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm turbo run build \
      --filter=@newsaas/api \
      --filter=@newsaas/worker \
      --filter=@newsaas/web

# ---------------------------------------------------------------------------
# runtime: el workspace compilado. Se copia completo (incluidas las
# dependencias de desarrollo) porque los paquetes del monorepo se resuelven por
# enlaces de pnpm y las migraciones usan la CLI de Prisma. Es más pesado que una
# imagen podada, pero es la opción verificable para el piloto; ver
# infra/deploy/README.md.
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]

FROM runtime AS worker
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

FROM runtime AS web
WORKDIR /app/apps/web
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]

# Migraciones + datos de referencia (permisos, roles, impuestos). Idempotente:
# la CI ejecuta el seed dos veces y compara conteos. NUNCA carga el demo.
FROM runtime AS migrate
WORKDIR /app/packages/database
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts"]
