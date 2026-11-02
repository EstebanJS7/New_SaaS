---
id: UX-029
type: story
title: Catalog staff UI consistency
epic: EPIC-09
status: done
priority: high
depends_on: [UX-028, UX-011]
prd_sections: ["1", "9", "10.1", "15", "29", "41"]
branch: main
created: 2026-11-01
updated: 2026-11-01
---

# UX-029 — Completar la experiencia staff de Catálogo

Continuación autorizada del roadmap V1 después de Pacientes. Alcance basado en
[[UX-027-BASELINE-2026-10-31]], [[Catalog-Taxes]], [[DEC-010]], [[DEC-065]],
[[DEC-080]] y [[ADR-002]]. No modifica el PRD ni crea operaciones nuevas.

## Criterios

- [x] Alta/edición/detalle en español con campos y ayudas visibles, errores
      asociados y foco en primer inválido según límites actuales.
- [x] Impuesto obligatorio con carga, error, vacío y relectura explícita;
      conserva orden Exento/IVA5/IVA10 y no infiere permisos de escritura.
- [x] Precio Decimal(14,2) y umbral Decimal(10,3) con entrada es-PY y
      normalización por texto; sin Number, redondeo o conversiones. Conserva
      PYG/USD, precio cero y umbral positivo, omisión/null y precisión exacta.
- [x] Detalle presenta precio/umbral exactos y nombres largos adaptables, con
      estados de lectura claros y retorno al listado UX-011.
- [x] Doble envío evitado; datos retenidos y comando bloqueado tras resultado
      incierto o 401/403/404, sin retry automático o mensajes privados.
- [x] Cancelación/enlaces explícitos y beforeunload protegen cambios locales,
      solo memoria; sin persistencia o interceptar Back/Forward.
- [x] Conserva búsqueda/contexto privado y desactivación confirmada, permisos,
      aislamiento y contratos. No altera tracksStock, ledger, POS, impuestos
      calculados, ventas, agenda, clínica o Portal.
- [x] Pruebas dirigidas y regresiones pertinentes, lint, tipos, builds aislados
      y verificador aprobados con binarios instalados.
- [x] Navegador API/BFF/PostgreSQL desechable prueba
      crear/editar/limpiar/volver, precio exacto, cancelación/desactivación,
      incertidumbre, permisos y aislamiento sin efectos rechazados. Revisión
      escritorio claro/móvil oscuro.
- [x] Story, módulo, continuidad, changelog y QA registran resultados y límites.

## Límites y plan

Cambiar las superficies actuales de Catálogo y su cliente web. La lane real
detectó un no-op válido de PUT vacío que Prisma devolvía como404; se corrige
localmente en CatalogRepository, preservando DTO, permisos y auditoría dentro de
la transacción. Esto satisface el contrato de omisión existente. Precio sigue
informativo, sin nuevos campos, endpoints, migraciones, permisos o dependencias.
No añade reactivación, gestión de impuestos o controles de stock. Catálogo es
INTERNAL; búsquedas se conservan privadas, sin contenido en URLs/logs/browser
storage. Guardia de salida local, sin framework genérico para tres dominios.
CRUD no gana idempotencia/CAS: resultado incierto exige revisar antes de
repetir. Sin commit/push, despliegue o CI remota asumida. [[TD-069]] registra el
posible cierre intermitente de servidores de prueba Windows; distinguirlo del
resultado de los casos, sin esconder fallos o sumar retries.

Implementar interacción y formatos conservando cuerpos, probar límites y
semántica, ejecutar stack aislado y revisar capturas antes de marcar done.

## Hallazgos de verificación

3odkMD encontró un fallo real al guardar sin cambios: contrato Zod permite PUT
vacío pero updateMany con data vacío devuelve count0 sin SQL, interpretado
como 404. Se conserva la intención del test y se corrige repositorio: para
cambios allowlisted vacíos resuelve id+tenant con la misma transacción y deja al
servicio su auditoría existente changedFields vacíos. Sin nuevo
endpoint/contrato.

[[TD-070]] registra expectativas antiguas de ventas/agenda probadas en HEAD. Se
adaptan solamente pruebas a UI es-PY y al diálogo real de revisión ya
implementado, conservando los cuerpos wire, escenarios y guardas. No se cambia
producto comercial, agenda, pagos, caja o stock por esos fallos.

## Implementación y verificación

- Formulario/new/edit: idioma, validación asociada/foco, impuestos con estados y
  retry de lectura explícito, copia local y salida protegida. Usa los helpers
  es-PY existentes para normalizar texto, sin aritmética nueva. Pares de precio
  y threshold conservan sus límites, ausencia/null y exactitud al editar.
- catalog-api/list/detail: errores sanitizados, estado incierto explícito,
  bloqueo por status y acuse mínimo con ID antes de navegar. No valida el DTO
  completo. Desactivación mantiene confirmación y no-op no reescribe datos.
- CatalogRepository: diferencia update vacío de recurso inexistente con lectura
  id+tenant dentro de la transacción recibida; servicio conserva auditoría única
  con changedFields vacíos. Las escrituras no vacías mantienen su predicado.
- TD-070: pruebas de consumidores actualizadas sin modificar producto financiero
  o agenda. Se conservan escenarios y payloads wire, con revisión real del pago.
- 314 pruebas distintas aprobadas: 277 web y 37 API/repo; simulación/HTTP con
  dobles separados de la lane PostgreSQL/navegador. No sumar rechecks.

Lint web/API, tipos, builds aislados y lane real se registran en
[[UX-029-VALIDATION-2026-11-01]]. Lane final duNb7k 6/6 (38,6s), sin retries,
cierre automático y contenedores retirados. Revisión visual final aprobada. No
cambios de esquema/endpoints/permisos/dependencias o PRD nuevos, ni commit/push.
TD-014 y TD-069 conservan sus límites.

Cierre UX-029: done. 314 pruebas distintas, lint/tipos/builds/verificador y
navegador aprobados. TD-070 resuelta; TD-014 y TD-069 siguen abiertas. Fallos
iniciales/interrupción conservados en QA. HEAD3292ffc con cambios locales
previos preservados, sin commit/push ni CI remota asumida. No se declara
completa toda la UI V1 por este cierre acotado de Catálogo.
