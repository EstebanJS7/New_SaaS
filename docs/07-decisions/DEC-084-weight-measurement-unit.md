---
id: DEC-084
type: decision
title: Explicit unit contract for clinical weight records
status: accepted
date: 2026-10-30
updated: 2026-10-30
related_epics: [EPIC-06]
related_stories: [UX-014]
prd_change_required: true
prd_updated: 2026-10-30
---

# DEC-084 — Unidad explícita en los registros de peso

## Contexto

Al iniciar UX-014 se revisaron código, esquema y contratos: ClinicalWeight solo
tiene quantity NUMERIC(10,3) y measuredAt, sin unidad. PRD §12 pide peso actual
pero no fija unidad ni conversión. DEC-067 alude a “weight plus unit” al
describir formas, pero no aprobó una unidad ni migración y el código nunca la
implementó. No es seguro inferir kg a partir del país, del nombre del módulo o
de la magnitud.

## Opciones e impacto

1. Contrato explícito de una unidad canónica para nuevos registros, con plan
   aprobado de migración/revisión de datos históricos. Es simple de operar, pero
   exige confirmar producto y la procedencia/unidad de cada dato previo.
2. Unidad por registro mediante enum controlado. Requiere esquema, DTOs, formas,
   consumidores y reglas exactas de conversión aprobadas; no basta añadir un
   sufijo visual. Históricos desconocidos deben seguir explícitamente
   desconocidos.
3. Mantener datos actuales sin atribuir unidad: consulta exacta y leyenda de
   unidad no especificada; sin cálculos ni interpretación de tendencia. Es la
   implementación compatible usada en UX-014, no una solución de registro
   futuro.

## Decisión aceptada — 2026-10-30

El responsable del producto aprobó kg tras revisar la propuesta concreta: “me
parece correcto lo de kg”. Se adopta la definición siguiente para la primera
entrega, con actualización explícita de PRD §12.1.

La definición queda aprobada; su implementación aún está pendiente. No se
modifican esquema, contratos ejecutables ni datos en esta etapa documental.
UX-014 conserva la presentación de unidad no especificada hasta implementarla;
TD-055 sigue abierto para entrada/corrección de pesos con esta definición.

## Definición aprobada

- Nuevas cargas desde la ficha: kilogramos, unidad explícita KG, cantidad
  estrictamente positiva y hasta tres decimales, conservando Decimal(10,3).
  Ejemplo de entrada es-PY: 0,125 kg equivale a 125 g. No redondear
  silenciosamente una entrada con mayor precisión ni agregar un máximo clínico
  supuesto.
- Primera entrega con entrada en kg; selección de gramos/libras y conversiones
  quedan fuera del alcance de esta primera entrega.
- Históricos: conservar cantidad exacta y unidad desconocida; sin backfill KG
  automático, conversión ni deducción por magnitud o especie. Confirmar una
  unidad histórica requiere acción explícita autorizada y auditada, nunca una
  lectura.
- Consumidores antiguos sin unidad no pueden reinterpretarse silenciosamente
  como KG. La Story de implementación debe conservar sus contratos y mantener
  esos registros como unidad desconocida hasta migrar conscientemente cada
  consumidor, o proponer una transición de contrato explícita.
- Presentación siempre con unidad conocida o su ausencia explícita. No mezclar
  desconocidos con KG para derivar peso actual, comparación o tendencia clínica.

La implementación deberá explicitar KG para las nuevas cargas staff y conservar
la ausencia de unidad en históricos y consumidores antiguos. No queda aprobada
una migración masiva de cantidades ni un backfill de unidades. La Story de
entrada/corrección deberá cubrir aislamiento, auditoría, precisión,
compatibilidad y tratamiento explícito de registros con unidad desconocida.

## Implementación — UX-017, 2026-10-30

La definición se implementó en UX-017. ClinicalWeight incorpora unit KG nullable
sin default ni backfill; DDL reproducible probado solo en bases desechables, sin
conversión de cantidades ni despliegue sobre datos operativos. Producto aclaró
que todavía no hay base productiva que migrar.

POST/PUT admiten KG opcional y preservan sus respuestas/GET legados. Crear o
cambiar cantidad sin unit explícita guarda unidad desconocida (también sobre KG
previo); fecha sola conserva unidad. Atribuir KG a un valor desconocido exige
confirmación manual staff auditada. La proyección staff nueva expone KG/null;
rangos exigen una unidad homogénea y el rango legado sin unidad consulta solo
valores desconocidos. Sin inferencias o conversiones. Ver Story y evidencia QA;
TD-055 resuelto funcionalmente, TD-066 abierto para límites de comandos/UI.
