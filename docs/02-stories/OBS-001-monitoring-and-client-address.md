---
id: OBS-001
type: story
title: Error tracking, backup alerting and the real client address
epic: EPIC-00
status: in-progress
priority: high
depends_on: []
prd_sections: ["§41"]
permissions: []
branch:
created: 2026-11-03
updated: 2026-11-03
---

# OBS-001 — Monitoreo, aviso de respaldos y dirección real del cliente

## Objetivo

Enterarse de los errores, de una caída y de un respaldo fallido sin revisar logs
a mano, y que el límite de intentos de inicio de sesión cuente por cliente.
Decisión: [[DEC-093]].

## En alcance

- `packages/observability`: inicialización opcional de Sentry, `captureError` y
  el filtro de datos `scrubEvent`.
- API: 5xx a Sentry desde el filtro global; `API_TRUSTED_PROXIES` →
  `trustProxy`.
- Worker: trabajos que agotaron sus reintentos y errores de cola a Sentry.
- Web: `instrumentation.ts` (solo Node.js) y reenvío de `X-Forwarded-For` en los
  BFF de inicio de sesión y recuperación.
- Despliegue: variables, red con rango fijo, Caddy restringe el dominio de la
  API, heartbeat en `backup-loop.sh`, `curl` en la imagen de PostgreSQL, README
  §9.

## Criterios de aceptación

- [x] Sin `SENTRY_DSN` no se inicializa nada y capturar no hace nada.
- [x] Un evento no lleva petición, usuario, extra, breadcrumbs, variables, ni
      etiquetas o contextos no revisados; el mensaje se recorta y se enmascara.
- [x] El worker no reporta un intento que se va a reintentar.
- [x] Sin proxies de confianza, la API ignora `X-Forwarded-For`; con la red
      interna, ve al cliente y no acepta un salto inventado por el navegador.
- [x] Los BFF pasan solo direcciones IP y solo en inicio de sesión y
      recuperación.
- [ ] Probar en el VPS: un error real llega a Sentry, el heartbeat llega, y el
      dominio de la API devuelve 404 fuera de lo público.
- [ ] `verify-local.ps1` con la red nueva.

## Verificación

```text
2026-11-03 (sandbox):
  observability: 5 OK · api: 2011 OK (2 fallas PREEXISTENTES del inventario
    clínico), trust proxy 4 nuevos · worker: 298 OK (3 nuevos) · web: auth y
    portal BFF, forwarded-for 2 nuevos; next build OK (el SDK solo en el bundle
    de Node.js)
  compose: YAML válido, variables resueltas en api/worker/web/backup
  backup-loop.sh: bash -n OK
No se pudo correr: Docker (Caddy, compose, imagen de PostgreSQL con curl).
```

## Decisiones / ADRs

- [[DEC-093]]
