---
id: DEC-083
type: decision
title: Appointment, clinical and sale journey boundaries
status: accepted
date: 2026-10-28
updated: 2026-10-28
related_stories: [UX-005]
prd_change_required: true
---

# DEC-083 — Cita, atención y venta

## Contexto

El usuario pidió mejorar el recorrido integrado manteniendo el trabajo de UX/UI.
Appointment ya guarda paciente/profesional/servicio; ClinicalEncounter y Sale no
guardan una asociación entre sí ni con Appointment. VET-004 excluye esa
relación. POS calcula precios e impuestos en el servidor y completa stock/caja
de forma transaccional. Navegar no debe hacer operaciones financieras
implícitas.

## Primera etapa compatible — UX-005

Conservar el ID de cita como contexto de navegación no autoritativo. Leer la
cita por el BFF autorizado, comprobar que corresponde al paciente y presentar
horario, estado, profesional y servicio. Mantener un acceso a agenda, ficha y
POS. Después de cerrar una consulta, ofrecer ir al POS; el operador sigue
eligiendo artículos, responsable e importes y confirma por separado. No crear
enlaces persistentes, completar turnos o crear ventas por navegar. Esta etapa no
necesita editar el PRD.

## Opciones para una segunda etapa persistente

| Opción                                                   | Impacto                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Solo contexto de navegación                              | Compatible hoy, pero no permite probar qué consulta o venta corresponde a la cita.                  |
| Asociación explícita desde Veterinary — recomendada      | Nuevas asociaciones tenant-scoped, contratos y migración; conserva Core libre de detalles clínicos. |
| Cierre clínico que completa cita y cobra automáticamente | Acopla estados y finanzas; no recomendado sin requisito y orquestación aprobados.                   |

## Propuesta para acordar antes de implementarla

- Permitir atención sin cita y venta independiente como actualmente.
- Definir cardinalidad: consultas por cita y ventas por atención; no asumir 1:1.
- Elegir explícitamente responsable de facturación; no inferir que el principal
  del paciente siempre es quien compra.
- Diferenciar profesional asignado a la cita del autor de la consulta.
- Sugerir el servicio de la cita solo con nueva lectura autorizada de catálogo,
  precio vigente y aceptación del operador; nunca usar agenda como fuente
  monetaria.
- Definir permisos para vincular/revincular, auditoría y correcciones después
  del cierre. No editar silenciosamente agregados confirmados.
- Aplicar claves compuestas de tenant, idempotencia y pruebas de aislamiento,
  concurrencia/reintento para que una asociación no duplique ventas o
  stock/caja.
- Resolver qué pasa con cita cancelada/no-show, consulta abierta o enmendada,
  venta cancelada y múltiples borradores.

La etapa inicial UX-005 implementó únicamente navegación. La etapa persistente
se aprobó posteriormente y se implementa en UX-006, con actualización explícita
del PRD §13.1. Las transiciones de negocio permanecen independientes.


## Aprobación — 2026-10-28

El usuario aprobó las reglas propuestas: varias consultas por cita, consultas sin
cita, varias ventas por atención y ventas independientes. Vinculación explícita;
servicio sugerido desde catálogo vigente y cliente seleccionado por el operador.
Cierre clínico, completar turno y cobro son acciones independientes.

Implementación mínima: registros tipados de asociación en Veterinary. Una consulta
tiene como máximo una cita de origen; una venta pertenece como máximo a una
consulta. No se modifica una asociación existente en esta etapa: se rechaza un
vínculo distinto y se conserva el historial. La corrección/revinculación requiere
operación futura con motivo/auditoría. El profesional de agenda no se convierte
en autor clínico. Los vínculos son CONFIDENTIAL y staff-only. No se copian notas,
precios ni responsable de facturación desde la cita.
