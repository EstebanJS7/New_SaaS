---
id: DEC-096
type: decision
title: Missing fiscal declarations required by the NCE-001 browser gate
status: accepted
date: 2026-11-09
related_epics: [EPIC-16]
related_stories: [FISC-019, NCE-001]
prd_change_required: false
---

# DEC-096 — Declaraciones fiscales necesarias para cerrar NCE-001

## Recomendación

Autorizar una entrega acotada de las dos declaraciones que la emisión ya exige:
el tipo de operación fiscal del cliente y la clasificación tributaria de las
alícuotas del tenant. No inventar valores por defecto ni fabricar una factura
aprobada para hacer pasar la prueba de navegador.

**Aceptada: opción A**, por selección explícita del usuario el 2026-11-09.
La implementación se registra en [[FISC-020]]; FISC-019 conserva sus criterios.
El PRD y las decisiones tributarias existentes no se modifican.

## Evidencia

- `packages/fiscal-persistence/src/receptor.read.ts:252`: un cliente sin
  `fiscalOperationType` produce `OPERATION_TYPE_NOT_DECLARED`. DEC-057 eligió
  una declaración explícita, no una inferencia a partir del tipo de cliente.
- `packages/fiscal-persistence/src/invoice-snapshot.read.ts`: la emisión exige
  la clasificación de la alícuota del tenant (`RATE_NOT_CLASSIFIED`).
- Las columnas/tablas y los lectores existen, pero las rutas actuales de
  clientes y de configuración fiscal no escriben estas declaraciones. Los
  seeds de referencia/demo tampoco las proveen.
- FISC-019 agrega certificado y CSC, no estas dos superficies. Por eso su
  criterio de factura `APPROVED` y posterior nota de crédito tiene un
  prerrequisito adicional al que describía la Story.
- La prueba focalizada de CSC en PostgreSQL sí pasa: carga por HTTP, lectura
  cifrada por el worker, aislamiento y límite concurrente de dos activos.

## Opciones

| Opción | Alcance e impacto |
| --- | --- |
| A — Completar las declaraciones faltantes (recomendada) | Aprobar una Story acotada para cargar/editar el tipo de operación fiscal por cliente y la clasificación tributaria por alícuota/tenant desde superficies autorizadas. Reutilizar permisos y límites de dominio existentes, validar en backend, aislar tenants y auditar donde corresponda. API, proxy, formularios mínimos y pruebas juntos; sin valores tributarios predeterminados. Luego ejecutar NCE-001 de extremo a extremo. |
| B — Mantener el alcance actual | Terminar certificado/CSC y sus pruebas, pero dejar explícitamente pendientes el criterio de navegador de FISC-019 y el cierre de NCE-001. No marcar las Stories como done ni sustituir el gate por SQL o una aprobación simulada. Las declaraciones se planifican en otra entrega. |

## Decisión

El usuario eligió «A — Completar las declaraciones faltantes (recomendada)».
Autoriza únicamente las dos superficies de declaración y sus verificaciones
necesarias, no un rediseño fiscal, nuevos proveedores, cambios del PRD, push ni
creación de PR.

## Limitaciones separadas

El fixture PKCS#12 existente identifica al emisor `80012345-6`, mientras que la
spec de configuración guarda actualmente `80012345-0`. El certificado de la
prueba debe generarse para el RUC declarado o el perfil de prueba debe usar
consistentemente el RUC del fixture; nunca se relajará la validación del
certificado de producción para acomodar el test.
