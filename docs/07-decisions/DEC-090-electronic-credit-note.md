---
id: DEC-090
type: decision
title: Electronic credit note for a reversed invoiced sale
status: accepted
date: 2026-11-02
related_epics: [EPIC-12, EPIC-14, EPIC-16]
related_stories: [NCE-001, SAL-REV-001]
prd_change_required: false
---

# DEC-090 — Nota de crédito electrónica al anular una venta facturada

## Contexto

[[DEC-089]] dejó decidido (Esteban Jiménez, 2026-11-02) que una venta con
factura vigente se corrige con una **nota de crédito electrónica (NCE)**, total,
y que hasta tenerla la anulación se rechazaba. Las reglas oficiales se leyeron
el 2026-11-02 del XSD, del Manual Técnico v150 y de las 27 Notas Técnicas
(`SIFEN-BASELINE.md` §27).

## Decisiones

1. **La NCE nace dentro de la anulación.** `POST /sales/:id/reverse` sobre una
   venta con factura `CONFIRMED` emite la nota en la misma transacción que las
   compensaciones de stock y caja. Si la nota no se puede emitir, la anulación
   entera se revierte con un `409` en castellano. No hay una ruta propia para
   emitir notas: hoy la única causa de una nota es una anulación.
2. **Solo sobre una factura aprobada por SIFEN.** El CDC asociado tiene que
   existir y no estar cancelado (reglas 2403, 2404). Factura en cola o enviada:
   «esperá la aprobación». Rechazada o con error: «cancelá la factura». Sin
   documento electrónico (camino no fiscal): «cancelá la factura». Con una
   cancelación en curso: «esperá su resultado».
3. **Crédito total, motivo 2 «Devolución».** Los ítems y totales son las líneas
   congeladas de la factura, así que el total de la nota es igual al de la
   factura y la regla 2417 se cumple por construcción. No hay tabla de líneas.
4. **Una tabla `credit_note`** con encabezado y numeración en una sola fila de
   solo inserción (la nota solo existe en el camino fiscal). La numeración sale
   de un **timbrado propio de tipo 5** en el establecimiento y punto de
   expedición que declara el perfil fiscal, con el mismo asignador y el mismo
   guardia de identidad que la factura. Una nota por factura y por anulación
   (UNIQUE).
5. **El documento fiscal de la nota es una fila más de `fiscal_document`** con
   `invoice_id` = la factura acreditada y `credit_note_id` = la nota. El índice
   «un documento vivo por factura» pasa a contar solo las filas con
   `credit_note_id` nulo; las notas tienen su propio índice. Un guardia hace
   ambas columnas inmutables y exige que la nota y el documento hablen de la
   misma factura. Así el envío, la firma, la reconciliación y la cancelación
   existentes sirven sin cambios.
6. **Se escribe `QUEUED` y se encola después del commit.** Si el encolado falla,
   la anulación ya está confirmada y el barrido de recuperación reenvía la fila
   `QUEUED`.
7. **Permiso:** `sales.reverse` (Propietario y Administración). La nota es parte
   de la operación de anulación, no una emisión fiscal suelta, así que no se
   exige además `fiscal.issue`.
8. **Fecha de emisión (`D002`)** = el momento de la anulación, no el de la
   factura. Receptor = el de la factura (mismo cliente), como exige la
   regla 2441.
9. **El aviso por correo al aprobarse** se omite para las notas: su texto habla
   de la factura. Queda como pendiente de contenido.

## Fuera de alcance

- Notas parciales, de descuento o de ajuste de precio.
- Nota de débito.
- Asociar facturas impresas (`H002 = 2`).
- Monedas distintas de PYG (la factura tampoco las emite).

## Impacto

- Migración aditiva `20261104000001_credit_note`.
- El tenant necesita **un timbrado de tipo 5** cargado en el mismo punto de
  expedición que el de facturas. Sin él, la anulación de una venta facturada
  responde «No hay un timbrado activo para notas de crédito…».
- La validación previa al envío (`assertValidDteRequest`) ahora controla los
  grupos por tipo de documento (§27.3).

## Decisión

Aceptada el 2026-11-02, siguiendo la decisión de producto de [[DEC-089]] §3.
