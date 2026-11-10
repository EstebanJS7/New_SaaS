/**
 * FISC-021 / DEC-098 — the KuDE's QR as an image.
 *
 * `dte.qr.ts` builds the QR's *content* (`dCarQR`); this turns that content into
 * a scannable symbol for the printed KuDE. It is the ONE file that imports
 * `qrcode-generator` (MIT, no dependencies); a test pins that, so the library
 * stays behind this function.
 *
 * The image is an SVG in a base64 data URL: the KuDE stays a self-contained HTML
 * document (nothing is fetched), and base64 keeps the URL inert inside an
 * attribute.
 */

import qrcode from "qrcode-generator";

/** Pixels per module; the SVG scales, this only sets its intrinsic size. */
const CELL_SIZE = 3;
/** The quiet zone ISO/IEC 18004 requires: four modules. */
const MARGIN = CELL_SIZE * 4;

/**
 * Encode `content` as a QR symbol and return it as `data:image/svg+xml;base64,...`.
 *
 * The version is chosen automatically and the error-correction level is `M`.
 * The library's byte mode keeps each character's low byte, so the content is
 * passed as its UTF-8 bytes: `dCarQR` is ASCII, and anything else is still
 * encoded rather than silently truncated.
 */
export function qrSvgDataUrl(content: string): string {
  const qr = qrcode(0, "M");
  qr.addData(Buffer.from(content, "utf8").toString("latin1"), "Byte");
  qr.make();
  const svg = qr.createSvgTag(CELL_SIZE, MARGIN);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
