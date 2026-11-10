/**
 * FISC-021 / DEC-098 — the KuDE for a signed request, with its QR drawn.
 *
 * `renderKudeForRequest` is what the worker calls at signing: the builder, the
 * QR image and the renderer in one place, so the worker never imports the QR
 * library ([[DEC-098]]: one file imports it).
 */

import { describe, expect, it } from "vitest";
import { validFacturaElectronicaRequest } from "../dte/dte.fixture.js";
import type { DteRequest } from "../dte/dte.types.js";
import { groupKudeCdc } from "./kude.format.js";
import { escapeHtml } from "./kude.html.js";
import { qrSvgDataUrl } from "./kude.qr.js";
import { renderKudeForRequest } from "./kude.render.js";

describe("renderKudeForRequest", () => {
  it("renders the CDC and the QR as an image of dCarQR instead of the text placeholder", () => {
    const request = validFacturaElectronicaRequest();
    const result = renderKudeForRequest(request);

    expect(result.outcome).toBe("RENDERED");
    if (result.outcome !== "RENDERED") return;
    expect(result.html).toContain(`CDC: ${groupKudeCdc(request.cdc)}`);
    expect(result.html).toContain(
      `<img class="qr" alt="QR" src="${escapeHtml(qrSvgDataUrl(request.gCamFuFD.dCarQR))}" />`
    );
    expect(result.html).not.toContain('class="qr-content"');
  });

  it("answers UNAVAILABLE, without throwing, for a type the KuDE has no model for", () => {
    const base = validFacturaElectronicaRequest();
    const request: DteRequest = {
      ...base,
      gTimb: { ...base.gTimb, iTiDE: 9 },
    };
    const result = renderKudeForRequest(request);
    expect(result).toMatchObject({ outcome: "UNAVAILABLE", refusal: "TYPE_NOT_PROFILED" });
  });
});
