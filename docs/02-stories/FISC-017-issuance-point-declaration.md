---
id: FISC-017
type: story
title: Declare the fiscal issuance point through the API
epic: EPIC-16
status: done
priority: high
depends_on: [FISC-011, FISC-015, NCE-001]
prd_sections: []
permissions: [fiscal.profile.manage]
branch: docs/dec-095-fiscal-issuance-point
created: 2026-11-09
updated: 2026-11-09
---

# FISC-017 — Declarar el punto de expedición fiscal por la API

## Objetivo

Que una clínica declare con qué establecimiento, punto de expedición y tipo de
documento emite, por una ruta soportada y validada, sin SQL. Primera entrega de
[[DEC-095]] (Opción A); avanza [[TD-075]].

## Contexto

[[DEC-057]] Q4 exige que el perfil fiscal declare su punto y que ese punto
resuelva a exactamente un rango de timbrado `ACTIVE`. Las columnas
`default_establishment_id`, `default_expedition_point` y `default_document_type`
existen (migración `20261010000001_fisc_015_fiscal_identity`, todo-o-nada), pero
ninguna ruta las escribe. Sin ellas la factura no obtiene identidad fiscal y la
nota de crédito ([[NCE-001]]) responde `409`.

## En alcance

- `PUT /fiscal/emitter-profile/issuance-point` con
  `{ establishmentId, expeditionPoint, documentType }`.
- `GET /fiscal/emitter-profile` devuelve también el punto declarado (campo
  aditivo).
- Auditoría `fiscal.issuance_point.declared`.

## Fuera de alcance

- La pantalla «Configuración fiscal» (entrega 2 de DEC-095) y el proxy web.
- El certificado de firma (entrega 3).
- Cambiar la resolución por sucursal de [[DEC-094]] §9.

## Criterios de aceptación

- [x] La ruta exige autenticación, membresía, la función `fiscal` y
      `fiscal.profile.manage`; sin permiso `403`, sin la función
      `FEATURE_NOT_ENTITLED`.
- [x] El cuerpo es estricto: `establishmentId` UUID, `expeditionPoint` de tres
      dígitos, `documentType` en (1, 4, 5, 6, 7, 9, 10); cualquier otro valor o
      campo extra es `400`.
- [x] Sin perfil fiscal: `404`. Establecimiento inexistente o de otro tenant:
      `404`.
- [x] `(establecimiento, punto, tipo)` debe resolver a exactamente un rango
      `ACTIVE` del tenant: ninguno `409` y ninguno escrito; más de uno `409` y
      ninguno escrito. Los mensajes nombran lo que falta.
- [x] Éxito: las tres columnas se escriben juntas con una auditoría
      `fiscal.issuance_point.declared` en la misma transacción; la respuesta
      devuelve el punto y si existe un rango `ACTIVE` de nota de crédito
      (tipo 5) para ese establecimiento y punto. Declarar de nuevo reemplaza el
      punto.
- [x] `GET /fiscal/emitter-profile` devuelve el punto declarado o `null`.
- [x] Con el punto declarado por la ruta, anular una venta con factura
      confirmada emite la nota de crédito (live-pg), sin SQL directo para el
      punto.
- [x] La ruta figura en el probe de permisos con `fiscal.profile.manage`.
- [x] Tests unitarios, live-pg y docs del módulo actualizados.

## API

### Agregado

```text
PUT /fiscal/emitter-profile/issuance-point   fiscal.profile.manage
```

## Verificación

2026-11-09 — resultados observados en `docs/dec-095-fiscal-issuance-point` (sin
commit todavía):

- RED antes de implementar: 19 tests fallaban (13 de `timbrado.service.test.ts`
  y 6 de `timbrado.zod.test.ts`, los bloques «FISC-017»); GREEN después: 79/79
  en `src/fiscal/timbrado`.
- `pnpm exec vitest run src/fiscal src/rbac`: 18 archivos, 263 tests, 0 fallidos
  (incluye el probe de rutas con `PUT /fiscal/emitter-profile/issuance-point` →
  `fiscal.profile.manage`).
- `pnpm test` (api): 138 archivos pasan, 15 omitidos; 2091 tests pasan, 275
  omitidos, 0 fallidos.
- `pnpm turbo run build --filter=@newsaas/api` y `pnpm test:live-pg`: 2
  archivos, 281 tests, 0 fallidos. El bloque «EPIC-16 FISC-017 issuance-point
  declaration» (5 casos) cubre `401`, `FEATURE_NOT_ENTITLED`, `FORBIDDEN`, el
  cuerpo estricto, los `404` (sin perfil, establecimiento de otro tenant), el
  `409` sin rango sin escribir nada, el éxito con las tres columnas y una
  auditoría, el `GET`, y la anulación de una venta con factura confirmada que
  emite la nota de crédito con el punto declarado por la ruta.
- `eslint`, `prettier --check` y `tsc --noEmit` sobre los archivos cambiados:
  sin errores.

Límites: el `409` con dos rangos `ACTIVE` está cubierto por tests unitarios, no
por live-pg. La aprobación SIFEN de la factura en el caso end-to-end se inserta
por SQL (ninguna ruta la escribe); el punto no. Los bloques live-pg FISC-015
conservan su SQL directo a propósito: prueban los CHECK y los estados «sin
rango»/«ambiguo» que la ruta no permite crear.

## Decisiones / ADRs

- [[DEC-057]], [[DEC-090]], [[DEC-095]]
