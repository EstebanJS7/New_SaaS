---
id: UX-013
type: story
title: Patient study search and paginated read surface
epic: EPIC-06
status: done
priority: high
depends_on: [VET-004, UX-012]
prd_sections: ["9", "12", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-013 — Consulta paginada de estudios del paciente

ID verificado disponible. Continuación autorizada de UX-012: sección de lectura
de estudios dentro de la ficha del paciente. Referencias: [[Clinical]],
[[TD-055]], [[DEC-067]], [[DEC-080]], [[ADR-001]]. No modifica el PRD ni los
criterios cerrados de EPIC-06.

## Criterios

- [x] POST estricto: q vacía o 2–80 caracteres, page 1–10000, páginas reales de
      veinte, conteo/paciente/filas en RepeatableRead y UUID de desempate.
- [x] Buscar solo studyType existente; todas las fechas o últimos treinta días
      móviles por performedAt, orden reciente/antiguo. Sin taxonomía, estados,
      adjuntos, diagnóstico o vínculos inventados; result no es buscable.
- [x] Staff/membresía activa y vet.clinical.read; permiso y entitlement
      veterinary reafirmados en servicio, tenant del contexto. Paciente/estudio
      ajeno, inexistente o de otro paciente devuelve el mismo 404.
- [x] Sección Estudios accesible desde navegación de ficha, detalle fresco con
      tipo/fecha/resultado, texto vacío explícito sin inferir estado clínico.
      Retorno conserva listado y foco accesible.
- [x] Búsqueda aplicada/filtro/orden/página por paciente en memoria del
      documento por diez minutos; sin URL, logs ni
      Storage/persistencia/deshidratación. Recarga/reingreso descartan contexto.
      Cancelar respuestas obsoletas.
- [x] Español/es-PY, tokens semánticos, controles etiquetados y estados de
      carga, vacío, error, reintento y límites de paginación.
- [x] Contratos anteriores GET/POST/PUT y consumidores conservados; sin cambios
      de tratamientos, consultas, prevención, Portal, finanzas ni pesos.
- [x] Pruebas HTTP/UI simuladas, PostgreSQL desechable real, lint, tipos y
      builds aislados aprobados. Sin revisión visual/E2E de navegador como gate
      de esta etapa acotada; evidencia separada. Actualizar módulo, QA, guía y
      TD-055.

## Clasificación y límites

Tipo, fecha, resultado, identificadores y texto de búsqueda: CONFIDENTIAL. Sin
campos nuevos persistidos, logs de contenido, proyección Portal o retención
nueva. Sin creación/corrección, seeds ni mutaciones operativas. TD-055 sigue
abierto para entrada/corrección de tratamientos/estudios y superficie de pesos.
Snapshot por petición, offset sin congelar páginas entre lecturas; collation
existente, sin fuzzy/normalización de acentos. last30 = 30 × 24 horas hasta el
instante del servidor, extremos incluidos y futuro excluido.

## Implementación y verificación

Implementados StudySearchController/Service y DTOs estrictos en
apps/api/src/clinical/study-search.*. La ficha monta study-list.tsx con cliente
y contexto temporal locales. El proxy clínico y el inventario de permisos
incorporan las dos lecturas aditivas. No cambia el servicio de registros
existente ni sus contratos GET/POST/PUT. Sin migraciones/dependencias.

155 pruebas distintas aprobadas: 68 API simuladas (20 HTTP nuevas, 25 rutas, 10
HTTP clínicas previas y 13 servicio de registros), 77 web (16 listado, 10 ficha
y 51 proxy nuevo/regresión) y 10 PostgreSQL real desechable. La base temporal se
elimina en finally; sin seeds ni mutaciones operativas.

Lint completo y typecheck API/web, builds aislados de ambas aplicaciones y
verificación de salida Next.js aprobados. Formato y diff sin errores. QA en
[[UX-013-VALIDATION-2026-10-30]] separa simulación, PostgreSQL y revisión visual
no ejecutada; no se certifica navegador/E2E, móvil ni lector de pantalla.

Módulo Clinical, guía UX/UI, changelog y TD-055 actualizados; el Epic conserva
su estado y el PRD permanece intacto. Cambios locales UX-012 conservados. Sin
commit ni push.
