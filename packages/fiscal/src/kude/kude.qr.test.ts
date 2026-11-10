/**
 * FISC-021 / DEC-098 — the KuDE's scannable QR.
 *
 * The helper turns `dCarQR`'s content into an SVG data URL the renderer embeds.
 * The checks are structural (no decoder is vendored): the prefix the `<img>`
 * needs, a real SVG with modules drawn, determinism — the KuDE stored at
 * signing and any later render of the same content must be the same picture —
 * and that the content, not something constant, drives the image.
 */

import { describe, expect, it } from "vitest";
import { qrSvgDataUrl } from "./kude.qr.js";

const PREFIX = "data:image/svg+xml;base64,";
const CONTENT =
  "https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=01800695631001001000000612021112917595714694" +
  "&dFeEmiDE=323032312d31312d32395431373a35393a3537&dRucRec=80000001&dTotGralOpe=110000&dTotIVA=10000" +
  "&cItems=1&DigestValue=665569394474586a4f4a396970724b7a6366794d4b6c304e7a6b674c346f383d&IdCSC=0001" +
  "&cHashQR=6a3f2a0d6b6e2f6c5e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f";

function svgOf(dataUrl: string): string {
  return Buffer.from(dataUrl.slice(PREFIX.length), "base64").toString("utf8");
}

describe("qrSvgDataUrl", () => {
  it("returns a base64 SVG data URL an <img> can embed", () => {
    const url = qrSvgDataUrl(CONTENT);
    expect(url.startsWith(PREFIX)).toBe(true);
    const svg = svgOf(url);
    expect(svg).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toMatch(/<path d="M\d+,\d+/);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("is deterministic for the same content", () => {
    expect(qrSvgDataUrl(CONTENT)).toBe(qrSvgDataUrl(CONTENT));
  });

  it("draws a different code for different content", () => {
    expect(qrSvgDataUrl(CONTENT)).not.toBe(qrSvgDataUrl(`${CONTENT}0`));
  });

  it("grows the symbol with the content, so the content is encoded rather than ignored", () => {
    const size = (url: string) => Number(/viewBox="0 0 (\d+) /.exec(svgOf(url))?.[1]);
    expect(size(qrSvgDataUrl(CONTENT))).toBeGreaterThan(size(qrSvgDataUrl("https://e.py/q")));
  });
});
