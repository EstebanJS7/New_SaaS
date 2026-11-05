---
id: DEC-093
type: decision
title: Error tracking, backup alerting and the real client address
status: accepted
date: 2026-11-03
related_epics: [EPIC-00]
related_stories: [OBS-001]
prd_change_required: false
---

# DEC-093 — Seguimiento de errores, aviso de respaldos y dirección real del cliente

## Contexto

El plan de salida a producción (Fase 2) pide saber cuándo algo falla sin mirar
logs a mano. Además, la API veía siempre la dirección del contenedor `web`: el
límite de intentos de inicio de sesión (que usa email + dirección) agrupaba a
todos los usuarios en una sola dirección, y el dominio público de la API dejaba
alcanzar todas las rutas, no solo las de marca.

## Decisiones

1. **Sentry para errores del servidor** (API, worker y servidor web), con el SDK
   `@sentry/node` en un paquete propio, `@newsaas/observability`, fijado en una
   versión exacta. **Apagado por defecto**: sin `SENTRY_DSN` no se inicializa
   nada. No es un servicio desplegable nuevo, sino un destino externo opcional.
2. **Qué se reporta:** respuestas 5xx de la API, errores no capturados del
   servidor web y trabajos del worker que **agotaron** sus reintentos (un
   intento que se reintentará no es un error todavía). Nunca los 4xx.
3. **Qué lleva un evento, decidido en un solo lugar** (`scrubEvent`), porque el
   sistema guarda datos clínicos, comerciales y fiscales (PRD §41):
   - sin petición (URL, query, cabeceras, cookies, cuerpo), sin usuario, sin
     `extra`, sin breadcrumbs, sin variables de los marcos de pila;
   - el mensaje recortado a su primera línea (un error de Prisma vuelca los
     argumentos después) con correos y números largos enmascarados;
   - solo las etiquetas `service`, `requestId`, `tenantId` y `job`. El
     `requestId` une el evento con los logs de la API.

   Además se desactiva toda la recolección del SDK (`dataCollection`), sin
   trazas de rendimiento.

4. **Errores del navegador: fuera de este paso.** Necesitan el SDK del navegador
   y ampliar la CSP (`connect-src`); queda como pendiente.
5. **Aviso de respaldos por heartbeat:** el servicio `backup` llama a
   `BACKUP_HEARTBEAT_URL` al terminar cada respaldo, y a `…/fail` si el respaldo
   o `pgbackrest check` (el archivo continuo del WAL) fallan. El monitor externo
   (Healthchecks.io, Better Stack) alerta también si un día no llega nada. La
   imagen de PostgreSQL suma `curl`.
6. **Caídas:** monitores HTTP externos sobre
   `https://APP_DOMAIN/api/health/live` y `https://API_DOMAIN/health/ready`
   (documentado en el README de despliegue).
7. **Dirección real del cliente:**
   - Caddy reemplaza el `X-Forwarded-For` del navegador por la dirección que ve.
   - Los BFF de inicio de sesión y recuperación (personal y portal) lo pasan a
     la API, solo si es una lista de direcciones IP.
   - La API confía únicamente en la red interna de Docker, que tiene un rango
     fijo `172.30.0.0/24` (`API_TRUSTED_PROXIES`, `trustProxy` de Fastify).

   Sin la variable, la API no confía en nadie, como antes.

8. **El dominio público de la API solo sirve** `/api/v1/public/*`,
   `/health/live` y `/health/ready`. El resto responde 404 en Caddy: el
   navegador usa la API a través de la web.

## Impacto

- Variables nuevas, todas opcionales: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`,
  `SENTRY_RELEASE` (el tag de la imagen), `BACKUP_HEARTBEAT_URL` y
  `API_TRUSTED_PROXIES`, que el compose de producción ya define.
- La red de Compose pasa a tener rango fijo. En un servidor ya desplegado hace
  falta `docker compose down` una vez antes del `up`.

## Decisión

Aceptada el 2026-11-03.
