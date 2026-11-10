---
id: DEC-098
type: decision
title: KuDE delivery to staff and by email, with a scannable QR
status: accepted
date: 2026-11-10
related_epics: [EPIC-16, EPIC-17]
related_stories: [FISC-021]
prd_change_required: false
---

# DEC-098 — Entrega del KuDE

## Contexto

El renderer del KuDE (`packages/fiscal/src/kude/`) genera un HTML imprimible,
pero nada lo sirve, lo imprime ni lo envía ([[Fiscal]] «The KuDE's delivery
surface», diferido por [[DEC-039]] y [[DEC-044]]). Además no se puede generar
después: se arma desde el `DteRequest` que el worker construye en memoria al
firmar y que no se guarda; reconstruirlo daría otro `dCodSeg` y otra hora. La
columna `fiscal_document.kude_storage_key` existe y nunca se escribe.

La homologación SIFEN pide el KuDE con un QR escaneable
(`docs/06-fiscal/SIFEN-HOMOLOGATION-RUNBOOK.md`), y el recorrido del PRD §36
dice «fiscal approval → KuDE available → notification».

## Opciones presentadas

1. Staff + QR: el worker genera y guarda el KuDE al firmar; el staff lo ve e
   imprime desde el detalle fiscal; QR con una dependencia chica.
2. Staff + QR + mail: lo mismo y además el KuDE va adjunto al mail automático
   que ya sale al aprobarse.
3. Staff sin QR: sin dependencia, QR como texto (no sirve para homologar).

## Decisión

Opción 2, elegida por el usuario el 2026-11-10 («Staff + QR + mail»).

- **Generación:** el worker arma el KuDE en el mismo paso en que firma, desde el
  mismo `DteRequest` y con el QR ya calculado, y lo guarda en el almacenamiento
  privado junto al XML. `kude_storage_key` se escribe con la misma condición que
  `xml_storage_key`. Un documento sin KuDE guardado (anterior a esta decisión, o
  de un proveedor que no firma) no tiene KuDE: no se inventa.
- **QR:** `qrcode-generator` (MIT, sin dependencias), importado por un solo
  archivo del paquete fiscal, que devuelve el QR como imagen SVG en un data URL.
  Se descartó escribir un codificador propio: es más código para mantener que la
  dependencia y no aporta nada.
- **Formato:** HTML imprimible; el navegador imprime o guarda como PDF. Sin PDF
  en el servidor (sería otra dependencia pesada sin requisito).
- **Staff:** `GET /fiscal-documents/:id/kude` con el permiso existente
  `fiscal.read`, aislado por clínica (otra clínica: `404`). El BFF lo releva con
  su tipo de contenido. «Ver KuDE» en el detalle del documento fiscal.
- **Mail:** el aviso automático de aprobación lleva el KuDE como adjunto HTML.
  El adjunto se pasa al canal **en memoria** (bytes), nunca como ruta o URL, por
  lo que [[ADR-011]] no cambia: `disableFileAccess` y `disableUrlAccess` siguen
  activos. El puerto del canal suma un campo opcional de adjuntos, con tamaño
  máximo y tipos permitidos cerrados. Si el KuDE no se puede leer, el aviso sale
  sin adjunto y eso queda registrado, sin el contenido.

## Fuera de esta decisión

- El portal del cliente ([[TD-022]] sigue diferido; la regla de visibilidad la
  decide el mantenedor).
- El formato ticket (rollo) del KuDE.
- Reenvío manual del mail.

## Clasificación

El KuDE lleva los datos del receptor (nombre, RUC/CI, dirección, contacto):
CONFIDENTIAL, como el resto de las referencias de `fiscal_document`. No se
registra su contenido en logs ni en el registro de entrega. Se envía solo a la
dirección del cliente de la factura, resuelta como hoy.
