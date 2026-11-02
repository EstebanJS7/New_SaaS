---
id: TD-070
type: tech-debt
title: Stale localization expectations in Sales and Agenda consumer tests
status: resolved
severity: low
owner: engineering
related_stories: [UX-002, UX-029]
created: 2026-11-01
updated: 2026-11-01
---

# TD-070 — Expectativas legadas de consumidores de Catálogo

La selección ampliada de UX-029 terminó 120 passed/41 failed en14 archivos. Los
seis archivos fallidos de ventas/agenda esperan labels/mensajes ingleses y
formatos anteriores, mientras producto y HEAD3292ffc ya presentan español/es-PY.
Se confirmó diff vacío en producto y pruebas de esos dos dominios antes de
corregir expectativas. Casos originales conservan su intención; no cambiar
producto, cálculos, DTOs, guards o backend de ventas/agenda para obtener verde.

Corrección acotada a tests: localizar selectores/mensajes y fixtures editables
es-PY, conservar todos los casos y cuerpos wire exactos, gates de permiso,
estado confirmado/replay/error, datos ausentes y controles fuera de alcance. El
caso de error de lectura de Catálogo debe seguir distinguiéndose de vacío sin
exigir el mensaje privado del servidor, ahora sanitizado por UX-029.

Regresión ampliada no se declara verde hasta reejecutar. Log inicial
ux029-regression.log (249,16s), conservado en evidencia QA UX-029. Esta deuda no
autoriza modificaciones de producto en ventas, pagos, caja, inventario o agenda.

## Resolución

277/277 pruebas web en21 archivos (110,09s), con los seis archivos originales de
consumidores y sin quitar escenarios. Lint web completo aprobado. Solo cambiaron
tests de ventas/agenda: selectores/copia es-PY, fixtures de edición y recorrido
del diálogo real ya implementado. Payloads exactos originales conservados; la
cantidad1,000 se ingresa explícitamente en el caso de wire1.000. No se
modificaron servicios, componentes o cálculos de esos dominios. El caso de fallo
de lectura de Catálogo exige mensaje seguro y conserva la distinción frente a
vacío. Resultado y fallos intermedios en QA UX-029.


### Ampliación de evidencia UX-030

La ejecución de toda Agenda detectó otros tres títulos legados en
agenda-calendar.test.ts: CONFIRMED/REQUEST, frente a Confirmado/Solicitud ya
implementados. Se alinean solo esas tres aserciones, preservando los ocho casos,
payload allowlist, ausencia de servicio y namespace de solicitudes. Regresión
Agenda100/100 con Node24.22.1/tz2026e instalado. Fallos de zona horaria del
Node22 habitual se registran por separado en TD-072 abierta, no resueltos por
localización. Evidencia [[UX-030-VALIDATION-2026-11-01]].
