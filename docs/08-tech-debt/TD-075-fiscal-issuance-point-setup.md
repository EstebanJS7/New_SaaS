---
id: TD-075
type: tech-debt
title: No supported path declares the fiscal profile's issuance point
status: resolved
severity: high
owner: engineering
related_stories: [FISC-015, NCE-001, FISC-017, FISC-018]
created: 2026-11-09
updated: 2026-11-09
---

# TD-075 — Ningún camino soportado declara el punto de expedición fiscal

Una nota de crédito electrónica ([[NCE-001]]) exige que el perfil fiscal de la
clínica declare su establecimiento y punto de expedición por defecto. Las
columnas existen desde la migración `20261010000001_fisc_015_fiscal_identity` y
solo se leen (`apps/api/src/fiscal/fiscal-allocation.service.ts`); ninguna ruta
de la API, pantalla, seed ni comando de operador las escribe. La suite live-pg
las carga con SQL directo.

Sin ellas, anular una venta con factura confirmada responde `409`: «El perfil
fiscal no declara un establecimiento y punto de expedición: no se puede emitir
la nota de crédito.»

## Impacto

- La prueba en navegador de NCE-001 no puede armarse sin SQL directo.
- Una clínica real no puede emitir notas de crédito sin intervención en la base.

## Etapa propia

Definir quién declara el punto (operador al dar de alta la clínica, o una
pantalla de configuración fiscal), con validación contra los rangos de timbrado
activos, auditoría y permisos. Es una decisión de alcance: proponerla en
`docs/07-decisions/` antes de implementarla. Propuesta: [[DEC-095]].

## Resolución

2026-11-09 — [[FISC-017]] agregó `PUT /fiscal/emitter-profile/issuance-point`
(validado contra los rangos `ACTIVE`, auditado, bajo `fiscal.profile.manage`) y
[[FISC-018]] la pantalla «Configuración › Configuración fiscal» que la usa. La
prueba en navegador `apps/e2e/specs/fiscal-settings.spec.ts` declara el punto
desde la pantalla, sin SQL. La prueba en navegador de NCE-001 sigue pendiente
por otra causa: aprobar la factura electrónica exige el certificado de firma
(sin pantalla hasta la entrega 3 de [[DEC-095]]) y el CSC (ninguna ruta lo
escribe).
