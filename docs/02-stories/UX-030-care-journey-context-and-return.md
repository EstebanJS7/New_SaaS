---
id: UX-030
type: story
title: Verified care journey context and encounter return
epic: EPIC-06
related_epics: [EPIC-07, EPIC-12]
status: done
priority: high
depends_on: [UX-005, UX-006, UX-029]
prd_sections: ["12", "13.1", "14", "18", "19", "29", "41"]
branch: main
created: 2026-11-01
updated: 2026-11-01
---

# UX-030 — Contexto verificable y retorno a la misma consulta

Primera etapa acotada de la revisión autorizada Agenda → atención → venta.
Inspección de UX-005/006, DEC-083 aceptada, PRD y módulos confirmó dos huecos:
CounterSurface no pasa el paciente esperado a AppointmentJourney, y el retorno
desde POS pierde la consulta seleccionada o no existe si la atención no tiene
cita. No se amplía el PRD ni se cambian asociaciones o transiciones de negocio.

## Criterios

- [x] POS verifica la cita contra el paciente del contexto cuando existe; ID
      inválido, error o paciente distinto no muestran identidad/servicio ajenos
      ni permiten sugerir ese servicio. POS independiente sigue utilizable.
- [x] Atención con o sin cita ofrece volver a la consulta exacta desde POS tras
      lectura autorizada de sus vínculos, preservando IDs válidos de navegación
      y priorizando el origen persistido. URL solo IDs, sin contenido sensible.
- [x] Fallos de lectura de cita/vínculos tienen recuperación GET explícita y
      mensajes seguros. No retry automático, refresh o navegación alternativa
      para ocultar fallos; no comandos al abrir, volver o reintentar lecturas.
- [x] Sugerir servicio requiere clic y catálogo activo leído; bloquea el uso de
      contexto mientras se revalida. No agrega cargos, cliente, asociación,
      finalización de turno, cierre clínico o cobro automáticamente.
- [x] Conserva las operaciones de vincular existentes, sus confirmaciones,
      idempotencia, permisos y auditoría, sin nuevos comandos o cambios backend.
- [x] Pruebas de contexto/retorno/errores y regresiones clínicas/POS pertinentes,
      lint, tipos, build aislado y verificador aprobados con binarios instalados.
- [x] Navegador con API/BFF/PostgreSQL exclusivamente desechable recorre agenda,
      atención y POS/retorno; navegación con cero efectos, vínculo explícito,
      denegaciones/aislamiento y contexto incompatible. Revisión escritorio
      claro/móvil oscuro, teclado y nombres largos.
- [x] Story, módulos, continuidad, changelog y QA actualizados con resultados y
      límites, sin declarar toda la UI V1 completada.

## Límites y plan

Cambiar composición frontend de contexto/retorno y feedback de lecturas. No
schema, endpoint, permiso, dependencia o abstracción genérica nuevos. Core
backend sigue libre de Veterinary. No editar clínica cerrada, guardias UX-026,
recuperación temporal/durable, payloads financieros, cálculo de totales, stock,
caja, pago, Portal ni vínculos persistidos por navegación. Vínculos existentes
permanecen inmutables; no revinculación silenciosa.

Datos de contexto CONFIDENTIAL; sin logs de payload, browser storage o texto en
URL. IDs no dan autoridad: backend verifica cada recurso. Sin base operativa,
migración dev, commit/push, despliegue o CI remota asumida. TD-069 conserva su
límite de cierre de procesos Windows; no ocultar fallos con retries.

Implementar controles/retorno locales, comprobar escenarios dirigidos y después
lane aislada real. El alcance no certifica íntegramente Agenda/POS ni introduce
idempotencia nueva a crear ventas; riesgos fuera del cambio se registran aparte.


## Implementación y cierre — 2026-11-01

AppointmentJourney valida el paciente esperado también en POS; estado de error
permite GET explícito. ClinicalAssociations agrega retorno exacto tras lectura
autorizada y bloquea acciones durante revalidación. CounterSurface conserva
contratos financieros y exige SERVICE activo actual al sugerir. No endpoints,
migraciones, permisos, dependencias o cambios PRD nuevos. Datos CONFIDENTIAL
sin persistencia browser ni contenido en URL; asociaciones no cambian por navegar.

406 pruebas distintas aprobadas: 306 clínicas/POS y 100 Agenda. Agenda se
verificó con Node24.22.1/tz2026e ya instalado; Node22.14.0 del PATH/tz2024b
discrepa en cinco casos de hora/rango, documentado en TD-072 abierta. Tres
expectativas legadas de títulos se alinearon a la UI española existente, sin
cambiar UTC, aislamiento del servicio o controles de conflicto. TD-070 amplía
su evidencia a ese test. No se afirma compatibilidad horaria entre runtimes.

Lint web completo, E2E/runner y test de calendario, tipos web/E2E, formato y
diff-check aprobados. Builds aislados referencia/database, API y Next con
verificador aprobados. PostgreSQL desechable + navegador/API/BFF: 8/8,49,0s,
sin retries, salida0, servidores/contenedores cerrados automáticamente. Capturas
escritorio claro/móvil oscuro revisadas, foco/Escape del modal; no auditoría
universal de accesibilidad. Historial/recuperación sin cambio de producto.

Fallos iniciales y límites íntegros en [[UX-030-VALIDATION-2026-11-01]]. TD-071
carrito/creación incierta, TD-072 runtime y TD-069 teardown Windows permanecen
abiertas. Cobro completo y cierre clínico desde UI fuera de esta verificación.
Sin commit/push, despliegue o CI remota asumida. UX-005 mantiene su estado review;
no se cierran otras Stories o toda UI V1 por esta evidencia acotada.
