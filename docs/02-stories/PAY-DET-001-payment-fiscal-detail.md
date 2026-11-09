---
id: PAY-DET-001
type: story
title: Payment detail for the factura electrónica
epic: EPIC-16
status: in-progress
priority: critical
depends_on: [POS-004, FISC-008, FISC-015]
prd_sections: ["§19", "§22"]
permissions: [sales.complete]
branch:
created: 2026-11-03
updated: 2026-11-09
---

# PAY-DET-001 — Datos del pago para la factura electrónica

## Objetivo

Que la factura electrónica lleve `gCamFE` y `gCamCond` como exige SIFEN, con los
datos de cada pago tomados en caja. Cierra [[TD-074]]. Decisión: [[DEC-091]].

## En alcance

- Base: columnas de detalle en `payment`, guardia de inserción y CHECK por
  medio.
- API: `POST /sales/:id/complete` acepta y valida `card`, `qrKind`, `check` y
  `otherDescription` según el medio; los guarda; la huella los incluye.
- Caja (web): al elegir Tarjeta, QR, Cheque u Otro aparecen los campos; «Revisar
  venta» no se habilita hasta completarlos; la revisión muestra el detalle.
- Fiscal: `gCamFE` y `gCamCond` en la factura, reglas por tipo de documento y
  «Condición de venta: Contado» en el KuDE.
- Worker: el ensamblado lee los pagos de la venta facturada y rechaza por nombre
  un pago sin el detalle.

## Criterios de aceptación

- [x] Un pago con tarjeta exige crédito/débito y marca (y nombre si es «Otra»);
      QR su tipo; cheque número y banco; «Otro» una descripción. API y base.
- [x] Un medio no acepta el detalle de otro.
- [x] La factura abre `gDtipDE` con `gCamFE` y `gCamCond`, un `gPaConEIni` por
      pago, `gPagTarCD` para tarjeta y `gPagCheq` para cheque.
- [x] `assertValidDteRequest` rechaza 1350/1351, 1500/1501, 1550, 1554,
      1600/1601/1602 y un cheque mal formado.
- [x] Un pago anterior sin detalle produce `PAYMENT_DETAIL_MISSING`, nunca un
      dato inventado.
- [ ] XSD oficial (CI con `DTE_XSD_REQUIRED=1`).
- [ ] Ambiente de test de SIFEN (habilitación).
- [x] Prueba en navegador del cobro con cada medio
      (`apps/e2e/specs/payment-detail.spec.ts`). Límite: ninguna lectura del
      proxy devuelve el detalle guardado; la persistencia se apoya en la guardia
      de inserción de la base.

## Base de datos

```text
20261105000001_payment_fiscal_detail
  payment_card_type, payment_card_brand, payment_qr_kind (enums)
  payment + card_type, card_brand, card_brand_name, qr_kind, check_number,
            check_bank, other_description (nulas)
  CHECK: detalle solo para su medio; nombre de marca sii OTHER; formatos SIFEN
  BEFORE INSERT: detalle obligatorio por medio
```

## Verificación

```text
2026-11-03 (sandbox):
  migración aplicada con psql sobre PostgreSQL 16
  simulacro SQL: cada medio con su detalle OK; rechazados: tarjeta sin detalle, sin
    marca, OTHER sin nombre, nombre sin OTHER, nombre corto, detalle de tarjeta en
    efectivo, QR sin tipo, cheque de 4 dígitos, cheque sin banco, Otro sin
    descripción, descripción en efectivo; filas anteriores sin detalle siguen válidas
  fiscal: 786 OK · fiscal-persistence: 106 OK · database: 1 falla PREEXISTENTE
  api: 2003 OK (2 fallas PREEXISTENTES del inventario de rutas clínicas)
  worker: 295 OK · web: ventas 150 OK, next build OK
No se pudo correr: XSD oficial, suites con el motor de Prisma.
```

## Decisiones / ADRs

- [[DEC-091]]
