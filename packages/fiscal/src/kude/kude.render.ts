/**
 * FISC-021 / DEC-098 — the KuDE for a signed request, ready to store.
 *
 * The worker calls this at signing with the SAME `DteRequest` it signed, with
 * `gCamFuFD.dCarQR` already holding the computed QR content: the builder reads
 * the request, the QR is drawn from `dCarQR`, and the renderer embeds it. The
 * worker never imports the QR library.
 */

import type { DteRequest } from "../dte/dte.types.js";
import { buildKudeDocument } from "./kude.builder.js";
import { renderKudeHtml } from "./kude.html.js";
import { qrSvgDataUrl } from "./kude.qr.js";
import type { KudeRefusal } from "./kude.types.js";

export type KudeRenderResult =
  | { readonly outcome: "RENDERED"; readonly html: string }
  | { readonly outcome: "UNAVAILABLE"; readonly refusal: KudeRefusal; readonly message: string };

/** Build and render the KuDE, or pass the builder's refusal through unchanged. */
export function renderKudeForRequest(request: DteRequest): KudeRenderResult {
  const built = buildKudeDocument(request);
  if (built.outcome === "UNAVAILABLE") return built;
  const html = renderKudeHtml(built.document, {
    qrImageDataUrl: qrSvgDataUrl(built.document.qr.content),
  });
  return { outcome: "RENDERED", html };
}
