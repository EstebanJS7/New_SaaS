---
id: FISC-021
type: story
title: KuDE generation, staff view and email attachment
epic: EPIC-16
status: in-progress
priority: high
depends_on: [FISC-019, NCE-001]
prd_sections: ["§36"]
permissions: [fiscal.read]
branch: feat/kude-delivery
created: 2026-11-10
updated: 2026-11-10
---

# FISC-021 — Entrega del KuDE

## Objetivo y autorización

[[DEC-098]], opción «Staff + QR + mail» elegida por el usuario: «El worker
genera el KuDE al firmar y lo guarda. El staff lo ve e imprime (o guarda como
PDF desde el navegador) con «Ver KuDE» en el detalle fiscal, también el de la
nota de crédito. Suma una dependencia chica para dibujar el QR escaneable que
exige la homologación.» y «además adjunta el KuDE al mail automático que ya sale
al aprobarse».

## En alcance

- **Worker:** al firmar una factura o nota de crédito electrónica, arma el KuDE
  desde el mismo `DteRequest`, con el QR como imagen, lo guarda en el
  almacenamiento privado y escribe `fiscal_document.kude_storage_key`.
- **Paquete fiscal:** función que devuelve el HTML del KuDE con el QR como SVG
  (`qrcode-generator`, un solo archivo la importa).
- **API:** `GET /fiscal-documents/:id/kude` (`fiscal.read`): `200 text/html` con
  el KuDE guardado; `404` si el documento es de otra clínica, no existe o no
  tiene KuDE.
- **Web:** el proxy fiscal acepta esa ruta y releva el HTML; «Ver KuDE» en el
  detalle del documento fiscal (facturas y notas de crédito) abre el KuDE en una
  pestaña para imprimir o guardar como PDF.
- **Mail:** el aviso automático de aprobación adjunta el KuDE (HTML, en
  memoria). Sin KuDE legible, el aviso sale igual, sin adjunto.

## Fuera de alcance

- Portal del cliente ([[TD-022]]), formato ticket, PDF en el servidor, reenvío
  manual del mail.
- KuDE para documentos firmados antes de esta story (no se reconstruye).

## Criterios de aceptación

- [ ] Un documento firmado guarda su KuDE y su `kude_storage_key`; un proveedor
      que no firma no guarda nada.
- [ ] El KuDE guardado lleva el CDC y un QR escaneable con el contenido de
      `dCarQR`.
- [ ] La ruta de la API devuelve el KuDE con `fiscal.read`, `403` sin el permiso
      y `404` entre clínicas o sin KuDE.
- [ ] «Ver KuDE» en el detalle fiscal abre el KuDE; sin KuDE no se ofrece.
- [ ] El mail de aprobación lleva el KuDE adjunto; sin KuDE sale sin adjunto.
- [ ] El canal de email sigue sin leer archivos ni URLs ([[ADR-011]]).

## Implementación

- **T1 — generación al firmar.** `packages/fiscal/src/kude/kude.qr.ts` (único
  importador de `qrcode-generator@2.0.4`) dibuja `dCarQR` como SVG en un data
  URL; `renderKudeForRequest` arma y renderiza el KuDE. La asamblea del worker
  lo renderiza desde el mismo `DteRequest` firmado, con `dCarQR` ya calculado, y
  la etapa de envío lo guarda con el prefijo `fiscal-kude_` y escribe
  `kude_storage_key` en el mismo `updateMany` condicionado a `SIGNING` que
  `xml_storage_key` y `cdc`. Si el tipo no tiene modelo, el renderer falla o el
  `put` del KuDE falla, el documento se envía igual y la clave queda nula; no se
  registra el mensaje del driver ni el contenido. Sin migraciones.

- **T2 — vista del staff.** API: `GET /fiscal-documents/:id/kude`
  (`fiscal.read`, fijado en la sonda de rutas) lee los bytes por
  `kude_storage_key` con el puerto de almacenamiento (`FiscalKudeService`) y
  responde `200 text/html; charset=utf-8`, `Cache-Control: no-store`,
  `Content-Disposition: inline; filename="kude-<cdc o id>.html"`. Id desconocido
  o de otra clínica: el mismo `404` byte a byte; sin KuDE: `404` propio; objeto
  ilegible: `500 INTERNAL` sin el mensaje del driver; id no UUID: `400`. La
  representación del documento suma `hasKude` (nunca la clave). BFF: el proxy
  fiscal acepta solo `GET fiscal-documents/:id/kude` y releva, solo para esa
  ruta, `Content-Disposition` y `Cache-Control`. Web: «Ver KuDE» en el detalle
  fiscal cuando `hasKude`, abre el KuDE en otra pestaña (`noopener noreferrer`).
  Las notas de crédito son filas de `fiscal_document` y aparecen en la misma
  lista y detalle, así que el mismo botón las cubre. Evidencia:
  `fiscal.integration.test.ts` («KuDE read (FISC-021)», «reports hasKude»),
  `route.test.ts` del proxy («FISC-021 KuDE relay»),
  `fiscal-detail-panel.test.tsx`. Criterios que T2 cree cumplidos (sin tildar
  hasta la verificación final): «La ruta de la API devuelve el KuDE con
  `fiscal.read`, `403` sin el permiso y `404` entre clínicas o sin KuDE» y «Ver
  KuDE en el detalle fiscal abre el KuDE; sin KuDE no se ofrece» (falta la
  prueba en el navegador, T4).

- **T3 — adjunto en el mail de aprobación.** Puerto del canal
  (`packages/notifications/src/channel/channel.port.ts`): campo opcional
  `attachments`, contrato cerrado — como máximo uno, solo
  `text/html; charset=utf-8`, 1 byte a 512 KiB, nombre
  `^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.html$`, exactamente las claves `filename`,
  `contentType`, `content` (bytes en memoria). SMTP pasa a nodemailer solo
  `{ filename, content: Buffer, contentType }`, con `disableFileAccess` y
  `disableUrlAccess` activos; fuera del contrato: `FAILED` no reintentable
  `CHANNEL_ATTACHMENT_REJECTED`, sin enviar. WhatsApp rechaza cualquier adjunto
  (`CHANNEL_ATTACHMENT_UNSUPPORTED`, sin llamada); el fake registra solo nombre,
  tipo y tamaño. Sin adjuntos, el mensaje es idéntico al anterior. Worker: el
  aviso fiscal ya apunta al `fiscal_document` aprobado; su lectura por clínica
  selecciona `kude_storage_key` y el builder devuelve una **referencia**
  (`FISCAL_KUDE`, clave, `kude-<serie>-<número>.html`). El handler de entrega
  lee el objeto del almacenamiento justo antes del envío, en cada intento, y lo
  adjunta solo en `EMAIL`. Clave nula, lectura fallida, objeto mayor al tope o
  nombre fuera del contrato: el aviso sale sin adjunto y la entrega no falla ni
  reintenta por el KuDE. Asunto y cuerpo sin cambios. Ni bytes ni clave en el
  job, el registro de entrega, los intentos ni los errores. [[ADR-011]] suma una
  nota (guardarraíles sin cambios). Evidencia: `email.channel.test.ts`
  («in-memory attachments», «the attachment contract»),
  `whatsapp.channel.test.ts`, `fake.channel.test.ts`,
  `notification-content.builder.test.ts` («the fiscal notice»),
  `notification-delivery.handler.test.ts` («the fiscal notice's KuDE
  attachment»). Criterios que T3 cree cumplidos (sin tildar hasta la
  verificación final): «El mail de aprobación lleva el KuDE adjunto; sin KuDE
  sale sin adjunto» y «El canal de email sigue sin leer archivos ni URLs». No se
  registra el motivo de un aviso sin adjunto: el handler no tiene un log sin
  contenido y DEC-098 dice «eso queda registrado»; queda como pregunta abierta.

## Verificación

Pendiente.
