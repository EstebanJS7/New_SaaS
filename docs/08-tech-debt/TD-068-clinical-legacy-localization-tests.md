---
id: TD-068
type: tech-debt
title: Stale localization assertions in legacy clinical frontend tests
status: resolved
severity: low
owner: engineering
related_stories: [UX-002, UX-026]
created: 2026-10-31
updated: 2026-10-31
---

# TD-068 — Expectativas antiguas de localización en pruebas clínicas legadas

La selección exploratoria amplia de UX-026 incluyó clinical-api.test.ts y
clinical-records.test.tsx (vacunas/desparasitación). Fallaron 21 expectativas:
mensajes/etiquetas inglesas y fecha ISO que el producto ya muestra en español /
es-PY. Las pruebas y sus módulos de producto no se modificaron en UX-026; no
importan el BFF modificado y usan fetch simulado. No es evidencia de regresión
del contrato de tratamientos/estudios/pesos. Log Temp/ux026-web-tests.log: 559
passed, 21 failed, 27 archivos. No presentar esa selección como verde.

Corregir estas expectativas en una etapa acotada de verificación de
localización, conservando los escenarios de permisos, validación, fechas y
comandos de ambos tipos. No alterar producto, quitar escenarios ni aceptar
fechas calculadas desde la función probada. No forma parte de los gates
especializados de UX-026.

## Trabajo iniciado — 2026-10-31

Continuación autorizada tras UX-026; rama main y cambios locales preservados.
Alcance: solo expectativas de los dos archivos, sin alterar comandos o producto.
Verificación: ambos archivos completos, lint dirigido, tipos web y formato.

## Resolución — 2026-10-31

Actualizadas únicamente expectativas/consultas de etiquetas y mensajes en
clinical-api.test.ts y clinical-records.test.tsx según el código inspeccionado.
Se conservan 33 + 27 escenarios, errores, permisos, payloads exactos,
omisión/null de próximas fechas y fechas UTC/tenant. El formateador se comprueba
con literales independientes: 19 oct. 2026 y 5 ene. 2026, sin derivar el
esperado de la función.

Ambos archivos completos: 60/60, salida 0, 5,03 s; lint dirigido y tipos web
aprobados. Formato/diff --check aprobados. Logs Temp/td068-final-tests.log,
td068-lint.log y td068-types.log. No cambios de producción, API/esquema/PRD,
comandos, dependencias, commit o push; cambios previos UX-026 preservados. No
nueva ejecución de build/PostgreSQL/navegador: solo tests/documentación.

Primera ejecución corregida: 53/60; siete fallos por usar Fecha de aplicación en
creación, donde el producto aún conserva Administered on. Se restituyó ese
selector real; corrección sí muestra Fecha de aplicación. Este residuo de
localización de producto queda identificado para continuidad UX-002; no se
traduce aquí ni se afirma que toda la superficie está localizada. Los fallos
históricos de UX-026 y esta ronda permanecen registrados, no se suman
resultados.
