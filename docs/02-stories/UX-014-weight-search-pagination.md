---
id: UX-014
type: story
title: Patient weight range filters and paginated read surface
epic: EPIC-06
status: done
priority: high
depends_on: [VET-004, UX-013]
prd_sections: ["9", "12", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-014 — Consulta paginada de pesos del paciente

ID verificado disponible. Continúa la lectura clínica autorizada: solo pesos del
paciente. Referencias [[Clinical]], [[TD-055]], [[DEC-067]], [[DEC-080]],
[[DEC-084-weight-measurement-unit]], [[ADR-001]]. Sin cambiar PRD/criterios
cerrados del Epic, dependencias ni abstracción compartida nueva.

## Criterios

- [x] POST estricto con page 1–10000, period all/last30, sort recent/oldest y
      minQuantity/maxQuantity opcionales, decimales positivos exactos dentro de
      NUMERIC(10,3), rango inclusivo y mínimo <= máximo. Sin q ficticia: no
      existe campo textual de peso. Nunca usar floats para comparar límites.
- [x] Páginas reales de veinte, paciente/conteo/filas en RepeatableRead; orden
      measuredAt y UUID ascendente, ajuste de páginas, rango y período
      combinables.
- [x] Veterinary y vet.clinical.read reafirmados en servicio, staff/membresía en
      HTTP, tenant del contexto. Paciente/peso ajeno, inexistente o de otro
      paciente recibe el mismo 404.
- [x] Sección Pesos y detalle de lectura con cantidad exacta y fecha; wire
      string de escala 3, presentación es-PY sin conversión/aritmética/redondeo.
      Unidad no especificada explícita: el modelo/contrato no fija kg u otra
      unidad. No gráfico de tendencia ni interpretación clínica sobre valores
      ambiguos.
- [x] Filtros aplicados/período/orden/página por paciente en memoria del
      documento diez minutos al abrir/volver o salir/remontar; sin texto/valores
      en URL, logs, Storage o persistencia/deshidratación. Recarga/reingreso los
      descartan. Aborto y protección de resultados obsoletos.
- [x] Español, es-PY, tokens semánticos, campos de rango locales con coma
      decimal, validación explícita, carga/vacío/error/reintento y
      navegación/foco accesibles.
- [x] GET/POST/PUT y consumidores anteriores conservados. Sin crear/corregir,
      migraciones, Portal, consultas, prevención, estudios/tratamientos,
      finanzas ni mutaciones operativas. TD-055 abierto para entrada/corrección.
- [x] Pruebas HTTP/UI simuladas, PostgreSQL desechable, lint, tipos y builds
      aislados aprobados; evidencia visual/E2E de navegador separada, no
      requerida como gate de esta etapa. Actualizar módulo, QA, guía, changelog
      y deuda.

## Clasificación y límites

Cantidad, fechas, identificadores y filtros clínicos son CONFIDENTIAL. Sin
campos persistidos, logs de contenido, retención ni exposición Portal nuevos.
last30 = treinta períodos de 24 horas hasta el instante del servidor, extremos
incluidos/futuro excluido. Offset/snapshot por petición, sin congelar entre
páginas. La unidad requiere decisión aprobada independiente, no se deduce de
valores existentes; [[DEC-084-weight-measurement-unit]] queda propuesta.

## Implementación y verificación

WeightSearchController/Service y DTOs estrictos en
apps/api/src/clinical/weight-search.*. UI weight-list.tsx con cliente, contexto
por paciente y parser local exacto. Proxy e inventario de permisos incorporan
POST search y GET UUID bajo el paciente. Contratos anteriores y cambios locales
UX-012/UX-013 conservados. Sin migraciones, dependencias o PRD modificado.

191 pruebas distintas aprobadas: 77 API simuladas (29 HTTP nuevas, 25 rutas, 10
HTTP previas, 13 registros), 104 web (26 rango/listado, 10 ficha y 68 proxy
nuevo/regresión) y 10 PostgreSQL real desechable. Datos sintéticos solo en la
base temporal; DROP exclusivo de esa base al finalizar, sin seeds/mutaciones
operativas. Detalles en [[UX-014-VALIDATION-2026-10-30]].

Lint completo API/web, tipos, builds aislados y verificación de salida Next.js
aprobados. Formato/diff sin errores. Sin revisión visual/E2E de navegador;
componentes jsdom no certifican aspecto final, móvil ni lector de pantalla.

Módulo Clinical, guía UX/UI, changelog y TD-055 actualizados. Las tres consultas
están entregadas; entrada/corrección sigue pendiente y la unidad requiere
definición aprobada. DEC-084 permanece propuesta, sin cambio del PRD ni
reenmarcar registros como kg. Sin commit ni push.
