---
id: FISC-017
type: story
title: Declare the fiscal issuance point through the API
epic: EPIC-16
status: in-progress
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

- [ ] La ruta exige autenticación, membresía, la función `fiscal` y
      `fiscal.profile.manage`; sin permiso `403`, sin la función
      `FEATURE_NOT_ENTITLED`.
- [ ] El cuerpo es estricto: `establishmentId` UUID, `expeditionPoint` de tres
      dígitos, `documentType` en (1, 4, 5, 6, 7, 9, 10); cualquier otro valor o
      campo extra es `400`.
- [ ] Sin perfil fiscal: `404`. Establecimiento inexistente o de otro tenant:
      `404`.
- [ ] `(establecimiento, punto, tipo)` debe resolver a exactamente un rango
      `ACTIVE` del tenant: ninguno `409` y ninguno escrito; más de uno `409` y
      ninguno escrito. Los mensajes nombran lo que falta.
- [ ] Éxito: las tres columnas se escriben juntas con una auditoría
      `fiscal.issuance_point.declared` en la misma transacción; la respuesta
      devuelve el punto y si existe un rango `ACTIVE` de nota de crédito
      (tipo 5) para ese establecimiento y punto. Declarar de nuevo reemplaza el
      punto.
- [ ] `GET /fiscal/emitter-profile` devuelve el punto declarado o `null`.
- [ ] Con el punto declarado por la ruta, anular una venta con factura
      confirmada emite la nota de crédito (live-pg), sin SQL directo para el
      punto.
- [ ] La ruta figura en el probe de permisos con `fiscal.profile.manage`.
- [ ] Tests unitarios, live-pg y docs del módulo actualizados.

## API

### Agregado

```text
PUT /fiscal/emitter-profile/issuance-point   fiscal.profile.manage
```

## Decisiones / ADRs

- [[DEC-057]], [[DEC-090]], [[DEC-095]]
