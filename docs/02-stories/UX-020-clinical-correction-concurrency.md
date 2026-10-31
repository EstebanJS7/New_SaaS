---
id: UX-020
type: story
title: Optimistic concurrency for specialized clinical corrections
epic: EPIC-06
status: done
priority: high
depends_on: [UX-015, UX-016, UX-017, UX-018, UX-019]
prd_sections: ["9", "12.1", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-020 — Concurrencia de correcciones clínicas

ID disponible verificado. Usuario autorizó continuar con version/CAS y 409 para
tratamientos, estudios y pesos. Sin ampliar PRD, historial o recuperación
durable. Referencias: [[Clinical]], [[TD-066]],
[[DEC-084-weight-measurement-unit]], [[ADR-001 Modular Monolith]],
[[UX-019-clinical-create-idempotency]].

## Criterios

- [x] Versión entera positiva por registro de los tres tipos; detalle staff
      devuelve versión junto con contenido de la misma lectura/snapshot. PUT
      acepta expectedVersion opcional validada; API antigua estricta rechaza el
      nuevo campo sin guardar. Respuestas de comandos/listas legadas intactas.
- [x] Comprobación y corrección bajo el mismo lock/transacción: dos solicitudes
      con baseline igual tienen un ganador y un 409 CONFLICT; el perdedor no
      cambia contenido/versión/auditoría. 404 para UUID ajeno/paciente
      incorrecto.
- [x] Escritores legados sin token siguen funcionando y avanzan versión; no se
      promete protección de sobrescritura a dichos consumidores sin token.
      Vacunas/desparasitación y consultas cerradas intactas.
- [x] Cambio clínico, incremento y auditoría atómicos; no-op vacío no incrementa
      ni audita, pero con versión obsoleta devuelve conflicto. Rollback íntegro.
- [x] UI solo corrige con versión válida del baseline; conserva campos ante
      conflicto, permite revisar el registro actual sin perder su copia y exige
      nueva selección/revisión explícita para otra corrección. Sin rebase ni
      retry automático; PUT incierto/pending sigue bloqueado, UX-019 intacta.
- [x] Recuperación UX-018 compara versión además de campos/unidad/instantes;
      rechaza baseline obsoleto aun si los valores volvieron a coincidir.
- [x] Precisión, es-PY, unidad/fechas, staff/membresía/veterinary/permisos y
      aislamiento preservados; sin URLs/logs/Storage de contenido. Versión por
      asociación clínica CONFIDENTIAL, sin nueva retención destructiva.
- [x] PostgreSQL real desechable de carreras/CAS/legacy/rollback/aislamiento y
      permisos, pruebas API/proxy/UI/recuperación y regresión UX-019; lint,
      tipos, Prisma y builds aislados. Sin migrar base configurada ni datos
      operativos. Visual/E2E no ejecutado en esta etapa acotada autorizada.
- [x] Clinical, TD-066, guía, changelog y evidencia QA actualizados. Cambios
      locales preservados; sin dependencias, commit/push o cambios fuera de
      scope.

## Implementación y clasificación

Implementado y verificado. Versión técnica asociada a historia clínica:
CONFIDENTIAL, staff solamente, sin Portal/logging/export nuevos. No snapshot
histórico nuevo. DDL reproducible solo en PG desechable; triggers incrementan
versión incluso con clientes legados, independientemente de precisión de
timestamps. Lecturas y locks SQL acotados permiten validar con cliente instalado
sin reemplazar el cliente generado/dist usado por procesos dev. Sin framework
Core nuevo.

## Implementación y verificación

Migración 20261030000003_clinical_record_version, triggers para tres tablas,
detalle staff versionado y PUT con expectedVersion opcional bajo lock.
Respuestas de comandos/listas legadas y UX-019 conservadas. UI sin fallback a
guardado sin versión, conflicto conserva copia y ofrece lectura actual separada;
recuperación compara versión incluso ante valores iguales. Sin rebase, PUT retry
automático, historial o recuperación durable. Permisos/tenant/veterinary y
precisión intactos.

598 pruebas distintas aprobadas: 127 API simuladas, 363 web/proxy, 15 estáticas
y 93 PostgreSQL real desechable. Lint/tipos, Prisma validate/generate y builds
API/database/web aislados con verificador Next aprobados. Sin procesos dev
interrumpidos, base operativa, commit/push o cambios del PRD. Clinical, TD-066,
guía UX/UI, changelog y QA actualizados. TD-066 sigue open para los límites
explícitos; sin nueva ronda de navegador/E2E por alcance autorizado.

Evidencia: [[UX-020-VALIDATION-2026-10-30]].
