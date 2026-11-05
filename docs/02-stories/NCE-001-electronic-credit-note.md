---
id: NCE-001
type: story
title: Electronic credit note for a reversed invoiced sale
epic: EPIC-16
status: in-progress
priority: high
depends_on: [SAL-REV-001, FISC-015]
prd_sections: ["§21", "§22", "§40"]
permissions: [sales.reverse]
branch:
created: 2026-11-02
updated: 2026-11-02
---

# NCE-001 — Nota de crédito electrónica al anular una venta facturada

## Objetivo

Que una venta cobrada **y facturada electrónicamente** se pueda anular: la
anulación emite una nota de crédito electrónica por el total y la envía a SIFEN.
Decisión: [[DEC-090]]. Completa [[SAL-REV-001]].

## En alcance

- Paquete fiscal: `buildDteRequestFromCreditNote` (`gCamNCDE`, un `gCamDEAsoc`
  con el CDC de la factura, sin `iTipTra`); reglas por tipo de documento en
  `assertValidDteRequest`; KuDE con «Motivo de la emisión» y «Documento
  asociado».
- Base: `credit_note`, `fiscal_document.credit_note_id`, índices y guardias.
- API: `FiscalCreditNoteService` dentro de la transacción de la anulación;
  `GET /sales/:id/reversal` devuelve la nota; el DTO fiscal expone
  `creditNoteId`.
- Worker: el ensamblado construye la nota (número, fecha y motivo propios); el
  aviso por correo al aprobarse se omite para notas.
- Web: el diálogo de anulación avisa de la nota; el detalle de una venta anulada
  muestra número y estado ante SIFEN; la lista fiscal distingue la nota.

## Criterios de aceptación

- [x] Una venta con factura `CONFIRMED` cuya FE está `APPROVED` se anula y deja
      una nota tipo 5 numerada en su timbrado y un documento fiscal `QUEUED`.
- [x] Factura pendiente, rechazada, en cancelación o sin documento electrónico:
      `409` en castellano y nada escrito.
- [x] Sin timbrado tipo 5 activo, o sin punto de expedición declarado: `409`.
- [x] Una nota por factura y por anulación; solo inserción; el rango debe ser
      del tenant y de tipo 5; la factura debe estar `CONFIRMED` (base de datos).
- [x] El documento de la nota no ocupa el lugar de la factura viva y no puede
      cambiar de documento.
- [x] El DE de la nota cumple 1450/1451/1452, 2400/2415, 2414, 2434, 2402 y
      D011.
- [x] El encolado ocurre después del commit y su fallo no deshace la anulación.
- [ ] Validación del XML de la nota contra el XSD oficial (caso agregado, corre
      en CI con `DTE_XSD_REQUIRED=1`).
- [ ] Prueba en el ambiente de test de SIFEN (habilitación).
- [ ] Prueba en navegador.

## Base de datos

```text
20261104000001_credit_note
  credit_note        UNIQUE tenant+invoice, tenant+sale_reversal, tenant+range+number;
                     CHECK motivo 1..8, CDC de FE, tipo 5; guardia de rango y de factura;
                     solo inserción
  fiscal_document    + credit_note_id (FK compuesta); índice de factura viva limitado a
                     credit_note_id NULL; índice propio para notas; guardia de pareja e
                     inmutabilidad
```

## Verificación

```text
2026-11-02 (sandbox):
  migración aplicada con psql sobre PostgreSQL 16
  simulacro SQL: nota + documento conviven con la FE viva; rechazados: UPDATE y
    DELETE de la nota, segunda nota de la misma factura, segundo documento vivo
    de la nota, segundo documento vivo de la factura, cambiar credit_note_id,
    CDC que no es de FE, motivo 9, factura en borrador, rango de tipo 1, rango de
    otro tenant, documento de nota con otra factura
  fiscal: 775 OK (credit-note 15 nuevos, kude 41)
  database: schema-credit-note 6/6; 1 falla PREEXISTENTE (ClinicalCreationReceipt)
  api: fiscal-credit-note 11/11, sale-reversal 15/15; fiscal+sales+billing 283 OK
  worker: 292 OK (ensamblado de la nota 2 nuevos, aviso 1 nuevo)
  web: panel de anulación 10/10, fiscal OK
No se pudo correr: XSD oficial (no se puede descargar desde el sandbox), suites
  que necesitan el motor de Prisma.
```

## Limitaciones conocidas

- ~~La factura electrónica no llevaba `gCamFE` ni `gCamCond`~~ ([[TD-074]],
  resuelta por [[PAY-DET-001]] el 2026-11-03).
- Si los datos fiscales del cliente cambiaron entre la factura y la nota, el
  receptor de la nota sale de los datos actuales (regla 2441).
- El aviso por correo de la nota aprobada no existe todavía.

## Decisiones / ADRs

- [[DEC-090]], [[DEC-089]]
