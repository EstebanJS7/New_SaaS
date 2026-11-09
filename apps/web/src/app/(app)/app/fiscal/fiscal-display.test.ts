import { describe, expect, it } from "vitest";
import { formatEsPyInstant } from "@/lib/es-py-format";
import {
  FISCAL_STATUS_LABELS,
  fiscalInputClassName,
  fiscalTextareaClassName,
  formatTimestamp,
  shortId,
} from "./fiscal-display";
import { FISCAL_DOCUMENT_STATUSES } from "./fiscal-api";
describe("fiscal-display", () => {
  it("labels all mirrored statuses", () => {
    expect(Object.keys(FISCAL_STATUS_LABELS).sort()).toEqual([...FISCAL_DOCUMENT_STATUSES].sort());
  });
  it("labels every status in Spanish with the SIFEN lifecycle vocabulary", () => {
    expect(FISCAL_STATUS_LABELS).toEqual({
      PENDING: "Pendiente",
      QUEUED: "En cola",
      SIGNING: "Firmando",
      SENDING: "Enviando a SIFEN",
      SUBMITTED: "Enviado a SIFEN",
      APPROVED: "Aprobado",
      REJECTED: "Rechazado",
      ERROR: "Error",
      CANCEL_PENDING: "Pendiente de cancelación",
      CANCELLED: "Cancelado",
    });
  });
  it("uses semantic control tokens", () => {
    for (const value of [fiscalInputClassName, fiscalTextareaClassName]) {
      expect(value).toContain("border-input");
      expect(value).toContain("bg-background");
      expect(value).toContain("text-foreground");
      expect(value).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(value).not.toMatch(/\[[^\]]+\]/);
    }
  });
  it("formats ids and timestamps without changing unknown literals", () => {
    expect(shortId("99999999-9999-4999-8999-999999999999")).toBe("99999999");
    expect(formatTimestamp("2026-10-01T09:30:00.000Z")).toBe(
      formatEsPyInstant("2026-10-01T09:30:00.000Z")
    );
    expect(formatTimestamp("2026-10-01T09:30:00.000Z").replace(/\s+/g, " ")).toBe(
      "1 oct. 2026, 06:30 a. m."
    );
    expect(formatTimestamp("2026-10-01T09:30:00.000Z")).not.toContain("UTC");
    expect(formatTimestamp("unchanged")).toBe("unchanged");
  });
});
