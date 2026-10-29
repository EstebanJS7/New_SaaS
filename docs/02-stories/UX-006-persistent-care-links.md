---
id: UX-006
type: story
title: Explicit appointment encounter and sale associations
epic: EPIC-06
related_epics: [EPIC-07, EPIC-12]
status: done
priority: high
depends_on: [UX-005]
prd_sections: ["13.1", "14", "18", "19", "29"]
permissions:
  [
    vet.clinical.read,
    vet.clinical.update,
    scheduling.appointment.read,
    sales.read,
  ]
branch: main
created: 2026-10-28
updated: 2026-10-28
---

# UX-006 — Vínculos explícitos de atención

Implementar DEC-083 aceptada por el usuario: relaciones 1 cita:N consultas y 1
consulta:N ventas, permitiendo operaciones independientes. Vínculos tipados
inmutables, tenant-safe, idempotentes y auditados, sin editar el contenido
clínico ni provocar efectos financieros. Reutilizar lecturas/comandos
autorizados y mantener Core sin dependencias de Veterinary.

## Criterios

- [x] Migración aditiva con FKs de organización/paciente y unicidad de origen.
- [x] API validada y autorizada: desconocido/ajeno 404; vínculo igual
      idempotente, vínculo incompatible 409; auditoría atómica sin contenido
      sensible.
- [x] UI para vincular consulta existente y ver vínculos, ir al POS/volver y
      asociar venta explícitamente; elegir cliente y confirmar cargos/pago
      aparte.
- [x] Servicio agendado sugerido solo desde catálogo activo y precio vigente.
- [x] Pruebas de permisos, aislamiento y concurrencia aplicables; lint, tipos,
      builds y migración verificadas. Evidencia y límites documentados.

## Clasificación

IDs de vínculo y contexto son CONFIDENTIAL, staff-only; nunca notas internas en
Portal, URL, logs o almacenamiento del navegador. Sin políticas destructivas.

## Verificación

La creación de consulta o venta y su vinculación son acciones separadas: si
falla el vínculo, el registro existente se conserva y se reintenta el mismo
comando de asociación, sin recrearlo. Sin commit/push solicitado.

- PostgreSQL real: **9/9** casos con las migraciones completas en una base
  temporal creada y eliminada por
  `pnpm --filter @newsaas/api test:clinical-links`. Cubre aislamiento, paciente,
  permisos/entitlements, auditoría/rollback, concurrencia, cardinalidades,
  unicidad, FKs e inmutabilidad. Resolver de permisos y entitlements sustituido
  en estas pruebas para controlar denegaciones; persistencia y AuditWriter
  reales.
- Web: **80/80** casos dirigidos de clínica, recuperación POS, asociaciones,
  contexto y proxy. Reejecución final de asociaciones/contexto: **12/12**, con
  un caso adicional que exige clic explícito para sugerir el servicio. Son
  ejecuciones solapadas, no un total sumable.
- Regresión clínica API: **26/26** de servicio y **10/10** HTTP. La primera
  ejecución HTTP recibió EACCES del sandbox al abrir puertos; fuera del sandbox
  pasó completa. No se atribuyó ese error a lógica de aplicación.
- Generación Prisma/build database, tipos API/web, lint dirigido y builds
  API/web correctos; el build web incluye comprobación de su salida. Los avisos
  preexistentes de referencias TypeScript/plugin ESLint de Next no impidieron
  compilar. Evidencia ampliada en [[UX-VALIDATION-2026-10-27]].
- Migración aditiva aplicada en la base local `newsaas`; no se borraron datos.

## Implementación

`ClinicalAppointmentLink` conserva tenant, paciente, consulta y cita con FKs
compuestas, unicidad de origen e índices de lectura. `ClinicalSaleLink` conserva
el vínculo consulta/venta en Veterinary; Core sigue independiente. Los triggers
rechazan UPDATE/DELETE. El comando bloquea consulta y, cuando corresponde, venta
para serializar asociaciones concurrentes; inserción y auditoría comparten
transacción. Repetir el mismo vínculo devuelve éxito sin nueva fila/auditoría.

Endpoints staff, con contexto tenant autenticado:

- `GET /patients/:patientId/clinical/appointments/:id/encounters`
- `GET /patients/:patientId/clinical/encounters/:id/links`
- `POST /patients/:patientId/clinical/encounters/:id/links/appointment`
- `POST /patients/:patientId/clinical/encounters/:id/links/sale`

Los POST aceptan únicamente `appointmentId` o `saleId` respectivamente. El BFF
permite solo estas rutas/métodos. Las lecturas ocultan IDs de dominios sin
permiso y distinguen falta de acceso de ausencia de vínculos. Los comandos
exigen permisos clínicos de lectura/actualización y lectura del dominio destino.

La ficha permite reabrir consultas vinculadas y elegir borradores existentes; el
POS permite volver al mismo paciente/consulta, reabrir ventas y confirmar el
vínculo de la venta recién creada. El servicio se incorpora solo por clic y se
resuelve en catálogo activo cargado; se usa precio de referencia vigente.
Cliente, importe final y pago requieren las decisiones y comandos habituales.

## Límites

- Sin nueva revisión en navegador ni certificación E2E visual del recorrido
  integrado, conforme al uso acotado acordado; no se ejecutó pago externo.
- No se modifican contenido de consultas cerradas, estados de
  cita/consulta/venta, stock, caja, pagos ni facturación al vincular.
- No hay reasignación/eliminación de vínculos. Una corrección futura requiere
  operación explícita con motivo y auditoría; no es requisito de esta etapa.
- El selector ofrece los borradores que devuelve el listado actual; no introduce
  búsqueda/paginación completa de servidor. El backend decide la compatibilidad.
- Revisión de usabilidad con personal y auditoría completa de accesibilidad
  siguen recomendadas en la guía consolidada.
