---
id: UX-024
type: story
title: Private manually saved clinical drafts across reloads
epic: EPIC-06
status: done
priority: high
depends_on: [UX-018, UX-019, UX-020, UX-022, UX-023]
prd_sections: ["13.3", "27", "41"]
branch: main
created: 2026-10-31
updated: 2026-10-31
---

# UX-024 — Borradores clínicos privados tras recarga

ID libre verificado; iniciada antes de código tras aceptación 1/1/1 de DEC-087.
PRD §13.3 actualizado explícitamente. Solo tratamientos, estudios y pesos; sin
cambiar compatibilidad pública, otros dominios, dependencias o servicios.

## Criterios

- [x] Guardar borrador explícito, recuperar/descartar explícitos por registro,
      persistencia servidor tras recarga, sin autoguardado ni Storage del
      navegador.
- [x] Solo autor, tenant/paciente/tipo, membresía/read/write/veterinary
      actuales; UUID ajeno 404, validación estricta, DTOs allowlisted y
      private/no-store.
- [x] Versión del borrador con CAS entre pestañas y replay seguro de su
      guardado; intento congelado y confirmado durable antes de envío, sin
      regenerar clave o baseline. Corrección pendiente/incierta bloqueada
      después de recarga.
- [x] Creación incierta reusa clave/comando; recibo backend autoritativo permite
      recuperar ID confirmado de peso y reintentar solo GET; no inferir por
      valores.
- [x] Completar/descartar lógicos y auditados con IDs/metadatos mínimos;
      contenido CONFIDENTIAL conservado sin purga, borrados o retención
      inventada.
- [x] Preservar UX-018–023, exactitud/unidades/fechas es-PY, contratos
      existentes y estados de carga/error/denegación/conflicto con controles
      semánticos.
- [x] Pruebas API/proxy/UI acotadas y PostgreSQL desechable real: carreras,
      respuesta perdida, auditoría única, aislamiento, permisos y rollback.
      Lint/tipos/builds aislados y recarga real en navegador de los tres tipos.
- [x] Actualizar módulo, deuda, guía, changelog y QA separando simulación,
      PG/E2E/visual. No base configurada/dev, datos operativos, commit o push.

## Implementación y verificación

Migración 20261031000001_clinical_working_draft, modelo Veterinary específico,
copias discriminadas y comando congelado. API aditiva drafts/search, GET/PUT
drafts/:id y POST drafts/:id/submit|complete|discard; cookie staff, validación
estricta, DTOs privados/no-store. Permisos read/create/update existentes, nunca
un rol como autoridad. Autor/tenant/paciente/tipo aislados, cursor UUID en body.

Guardado manual con ID estable, replay y CAS; baseline completo y clave
inmutables. Preparación PENDING auditada antes de dispatch, seguida de la
transacción clínica existente. No atomicidad inventada entre ambos commits:
fallo posterior conserva PENDING conservador. Creación repite comando/clave,
corrección incierta no se reenvía. Peso recupera ID desde recibo autoritativo y
solo GET de proyección; complete se acusa después de recibir proyección válida.
Fallo de ese acuse conserva copia pendiente y no invalida éxito clínico.

Complete/discard retiran lógicamente la lista y conservan contenido; no cancelan
comandos enviados. Trigger protege terminales, intentos congelados y DELETE.
Auditoría co-transaccional de cada transición con IDs mínimos; contenido, actor,
claves y baseline CONFIDENTIAL, sin purga/Storage/URLs/logs de payloads.

Tres formularios con Guardar borrador y consulta explícita Borradores guardados,
relectura autorizada al recuperar, estados de error/carga/conflicto y textos de
privacidad/descarte. Confirmar bloqueado durante save o con respuesta incierta;
reintento del save usa el mismo ID/versión. UX-018 temporal conservada.

[[UX-024-VALIDATION-2026-10-31]] registra 398 web/proxy, 137 backend simulados,
45 database/esquema y 95 PG real aprobados: 675 casos distintos sin sumar
reejecuciones. Builds, tipos y lint aislados, Prisma validate/generate en Temp.
E2E completo encontró recurrencia TD-067 antes de los nuevos casos; selección
focalizada y revisión visual se registran por separado. No marcar done con gates
pendientes/fallidos; no se presenta selección parcial como lane completa verde.

Ocho E2E nuevos aprobados en dos selecciones, seis capturas desktop/390 px
inspeccionadas. La lane inicial tuvo 16 passed/1 failed/8 no ejecutados por
navegación lista→ficha; se conservó review hasta resolver TD-067.

Cierre mediante UX-025, 2026-10-31: dos lanes completas independientes con 26/26
cada una, incluidos los 25 flujos clínicos y 50 contextos nuevos por ronda.
Lectura de paciente retenida verifica carga; documento y copias conservados, sin
retries/goto alternativo. TD-067 resolved para esta matriz. Gates de cierre
satisfechos, sin ocultar los resultados iniciales. Ver
[[UX-025-VALIDATION-2026-10-31]].
