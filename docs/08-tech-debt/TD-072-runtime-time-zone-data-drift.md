---
id: TD-072
type: tech-debt
title: Runtime time zone data drift in local Node installation
status: open
severity: medium
owner: engineering
related_stories: [UX-030, UX-002]
created: 2026-11-01
updated: 2026-11-01
---

# TD-072 — Divergencia de tzdata entre runtimes instalados

La regresión ampliada de Agenda durante UX-030 encontró diferencias
reproducibles entre dos binarios ya instalados. Node del PATH 22.14.0 informa
ICU76.1/tz2024b; el runtime de Codex 24.22.1 informa ICU78.3/tz2026e. Para el
mismo instante 2026-09-14T12:00:00Z y zona America/Asuncion, Intl muestra 08:00
y 09:00, respectivamente. No depende de TZ del proceso: la zona se pasa
explícitamente. No se deduce una regla legal nueva ni se modifica el calendario
del producto.

Tres aserciones horarias y dos escenarios de conflicto dependientes del rango
fallan con el primer runtime. No cambiar los UTC esperados ni el producto para
normalizar datos de zona antiguos. La ejecución contrastada usa el segundo
binario instalado; evidencia completa en [[UX-030-VALIDATION-2026-11-01]].

Actualizar/alinear el runtime local habitual y la política de tzdata de
desarrollo/despliegue en etapa propia; comprobar las imágenes/runtime reales
antes de producción. Esta Story no instala dependencias, cambia el PATH del
usuario, modifica servicios dev o certifica la zona horaria del despliegue. No
cerrar la deuda solo porque la prueba pasa con el runtime alternativo.
