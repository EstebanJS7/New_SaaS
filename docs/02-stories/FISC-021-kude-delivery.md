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

- [x] Un documento firmado guarda su KuDE y su `kude_storage_key`; un proveedor
      que no firma no guarda nada.
- [ ] El KuDE guardado lleva el CDC y un QR escaneable con el contenido de
      `dCarQR`.
- [x] La ruta de la API devuelve el KuDE con `fiscal.read`, `403` sin el permiso
      y `404` entre clínicas o sin KuDE.
- [x] «Ver KuDE» en el detalle fiscal abre el KuDE; sin KuDE no se ofrece.
- [x] El mail de aprobación lleva el KuDE adjunto; sin KuDE sale sin adjunto.
- [x] El canal de email sigue sin leer archivos ni URLs ([[ADR-011]]).

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

- **T4 — prueba en el navegador y cierre de docs.**
  `apps/e2e/specs/kude-delivery.spec.ts` (nuevo) recorre la story completa con
  las apps construidas: configura «Configuración fiscal» por la pantalla, crea
  un cliente con contacto EMAIL por corrida, vende, confirma y emite la factura;
  el worker (proveedor fake, TEST, DE firmado) la aprueba. La configuración y la
  venta hasta `APPROVED` salieron de `electronic-credit-note.spec.ts` a
  `apps/e2e/support/fiscal-issuance.ts`, sin cambiar lo que esa spec prueba. Un
  solo worker hace el pipeline fiscal y el correo (`startMailWorker` con
  `FISCAL_WORKER_ENV`), porque `FiscalApproved` se despacha en proceso.
  `apps/e2e/support/mime.ts` lee el adjunto del mensaje crudo que captura el
  sumidero SMTP.

## Verificación

- **T1:** fiscal 829/829, worker 308/308; builds, lint, typecheck y prettier
  pasan; el padre reejecutó el handler 48/48. Lockfile: solo
  `qrcode-generator@2.0.4`.
- **T2:** API 2148 pasan / 277 omitidas; web 2391 pasan con 1 falla de tiempo
  ajena (recuperación clínica, 67/67 sola); typecheck, lint y prettier pasan; el
  padre reejecutó la integración fiscal y la sonda de rutas 57/57.
- **T3:** notificaciones 95, worker 319 en verde; el padre reejecutó el canal de
  email 20/20.
- **T4, navegador** (`kude-delivery.spec.ts`, verde dos veces seguidas sobre la
  base persistente; `electronic-credit-note.spec.ts` verde de nuevo tras extraer
  los helpers; carril completo: 34/35 con `kude-delivery` en verde; la única
  falla fue `branches.spec.ts` (`toHaveURL` a `/app/settings/branches` tras un
  clic de navegación), que corre antes y no toca nada de esta story, y pasó sola
  a continuación). Observado:
  - el documento aprobado trae `hasKude: true` (el worker guardó el KuDE al
    firmar);
  - el detalle de «Documentos fiscales» muestra «Ver KuDE» con
    `href=/api/fiscal/fiscal-documents/<id>/kude` y `target=_blank`;
  - la ruta, con la sesión de la página: `200`, `text/html; charset=utf-8`,
    `no-store`, `inline; filename="kude-….html"`; el cuerpo lleva `CDC: ` con el
    CDC en grupos de cuatro y `<img class="qr">` con un SVG en
    `data:image/svg+xml;base64,`, sin el texto de reemplazo `qr-content`;
  - el enlace abre una pestaña nueva en esa ruta, con título «KuDE de Factura
    Electrónica …», el CDC y la imagen del QR visibles;
  - el mail de aprobación llega al contacto del cliente con un único adjunto
    `text/html; charset=utf-8`, nombre `kude-….html`, y sus bytes decodificados
    son idénticos a los que sirve la ruta.

### Limitaciones

- Un aviso que sale sin KuDE (clave nula, lectura fallida, objeto mayor a 512
  KiB) no deja registro del motivo; queda la pregunta abierta de T3.
- Si el `put` del KuDE falla al firmar, el documento se envía sin KuDE y en
  silencio: sin métrica ni registro.
- Los documentos firmados antes de esta story no tienen KuDE y no se
  reconstruye.
- Portal del cliente diferido ([[TD-022]], decide el mantenedor).
- El QR se verificó estructuralmente (SVG en base64, determinista, crece con el
  contenido), no decodificado: no hay decodificador QR entre las dependencias.
  Escanear el QR impreso queda para la corrida de homologación (filas 11 y 12
  del runbook); por eso el criterio «QR escaneable con el contenido de `dCarQR`»
  queda sin tildar.
- La prueba en el navegador cubre una factura; la nota de crédito usa la misma
  ruta y el mismo botón (pruebas unitarias e integración de T2), no se abrió su
  KuDE en el navegador. «Sin KuDE no se ofrece» se prueba en
  `fiscal-detail-panel.test.tsx`, no en el navegador.
