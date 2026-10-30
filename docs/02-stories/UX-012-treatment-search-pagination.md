---
id: UX-012
type: story
title: Patient treatment search and paginated read surface
epic: EPIC-06
status: done
priority: high
depends_on: [VET-004, UX-008, UX-011]
prd_sections: ["9", "12", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-012 — Consulta paginada de tratamientos del paciente

ID verificado disponible. Alcance autorizado: primera etapa de los listados
clínicos, solo tratamientos, dentro de la ficha del paciente. Referencias:
[[Clinical]], [[TD-055]], [[DEC-067]], [[DEC-080]], [[ADR-001]]. No cambia el
PRD ni reabre los criterios de EPIC-06.

## Criterios

- [x] POST de lectura estricto, búsqueda por descripción (vacía o 2–80
      caracteres), páginas de 20, conteo y filas en RepeatableRead, desempate
      UUID.
- [x] Filtro todas las fechas o últimos 30 días móviles según administeredAt;
      orden fecha de administración reciente/antigua. No inventar estados,
      medicamentos, dosis ni vínculos con consultas que el modelo no contiene.
- [x] Staff y membresía activa; vet.clinical.read y entitlement veterinary
      reafirmados en servicio. Tenant del contexto, paciente y tratamiento
      aislados; inexistente, otro paciente o tenant devuelven el mismo 404.
- [x] Sección Tratamientos accesible desde la navegación de la ficha; detalle de
      lectura con descripción, fecha y contexto existente, y retorno al listado.
- [x] Conservar búsqueda aplicada/filtro/orden/página por paciente durante diez
      minutos en memoria del documento al salir y volver. Nunca URL, logs,
      localStorage, sessionStorage o persistencia/deshidratación de QueryClient.
- [x] Español, es-PY, tokens semánticos, controles etiquetados, carga, vacío,
      errores, reintento y navegación limitada. Peticiones abortables sin
      mostrar resultados de una búsqueda/paciente anterior.
- [x] GET y comandos existentes mantienen sus contratos; sin escrituras,
      cálculos, cambios de consultas, prevención, Portal, estudios o pesos.
- [x] Pruebas HTTP/autorización y UI simuladas, aislamiento/paginación en
      PostgreSQL desechable, lint, tipos y builds aislados aprobados. Evidencia
      visual/E2E de navegador separada y no requerida en esta etapa acotada.
- [x] Actualizar módulo, QA, guía UX/UI, changelog y alcance pendiente TD-055.

## Clasificación y límites

Descripción, contexto, identificadores y fechas clínicas: CONFIDENTIAL. Sin
campos persistidos nuevos, logs de texto, proyección Portal o retención nueva.
No crear/corregir tratamientos ni validar con mutaciones clínicas operativas.
TD-055 continúa abierto: falta entrada/corrección de tratamientos y superficies
de estudios/pesos. Búsqueda por collation existente, sin fuzzy ni normalización
de acentos; paginación offset con snapshot por petición, no entre peticiones.

## Implementación y verificación

Implementado con TreatmentSearchController/Service y DTOs estrictos en
apps/api/src/clinical/treatment-search.*. El proxy clínico existente incorpora
POST de búsqueda y GET de detalle bajo el paciente. La ficha monta
treatment-list.tsx; cliente y contexto temporal quedan en archivos locales a esa
sección, sin abstracción compartida nueva.

Endpoints aditivos:

- POST /patients/:patientId/clinical/treatments/search
- GET /patients/:patientId/clinical/treatments/:id

Sin migraciones ni dependencias. GET de listas, POST/PUT y sus consumidores
anteriores conservados. Lint completo API/web aprobado, con lint acotado API
repetido después de las últimas adiciones. Typecheck API/web y builds finales
aisladamente aprobados, incluida verificación de salida Next.js.

138 pruebas distintas aprobadas: 68 API simuladas (20 nuevas HTTP + 25
inventario de rutas + 13 servicio de registros + 10 HTTP clínico existente), 60
web/componentes/proxy/ficha y 10 PostgreSQL real desechable. La prueba
PostgreSQL elimina exclusivamente su base temporal al terminar; sin seeds ni
mutaciones operativas. Sin revisión visual/E2E de navegador. Detalle de
comandos, correcciones y límites en [[UX-012-VALIDATION-2026-10-30]].

Módulo Clinical, guía UX/UI, TD-055 y changelog actualizados. El Epic no cambia
de estado y el PRD permanece intacto. Sin commit ni push en esta etapa.
