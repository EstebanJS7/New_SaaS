---
id: TD-069
type: tech-debt
title: Intermittent Windows Playwright server teardown hang
status: open
severity: low
owner: engineering
related_stories: [UX-028]
created: 2026-11-01
updated: 2026-11-01
---

# TD-069 — Cierre intermitente de servidores Playwright en Windows

## Evidencia

Lane UX-028 NJvR8X: seis casos terminaron ok sin retries antes de quedarse en
cierre. API/Next propios continuaban vivos y Playwright no imprimía resumen. El
código instalado de Playwright 1.64.1 usa taskkill /T /F en Windows; se
observaron procesos taskkill y consultas CIM con avisos Call cancelled. Esto
localiza el incidente en cierre de procesos, sin probar su causa raíz.

Se verificaron PID y command line contra el directorio temporal exacto de la
lane y se detuvieron únicamente sus servidores API/Next. Playwright terminó 6/6,
salida0, duración total4,7m, y el finally del runner retiró PG/Redis propios. No
se reinició ningún caso, se alteraron aserciones o se cerraron procesos dev. Las
lanes anteriores kQBrTf y tt5nkn terminaron automáticamente6/6.

## Trabajo pendiente

Reproducir y acotar la terminación Windows usando binarios instalados y procesos
exclusivos de prueba. Determinar por qué el cierre de árbol puede quedar
pendiente. Si hace falta una salvaguarda local, verificar PID/ruta y esperar el
cierre; no matar procesos por nombre, ocultar un fallo, ampliar retries o
cambiar navegación para obtener verde. No modificar procesos/configuración del
usuario.

## Cierre requerido

Prueba del escenario y de la retirada automática de servidores/contenedores
propios, incluyendo fallo de test. Evidencia separada del resultado de los casos
de producto. UX-028 no certifica cierre automático universal en Windows.
