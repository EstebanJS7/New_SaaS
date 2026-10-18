import { describe, expect, it } from "vitest";
import { FISCAL_NOTICE_CHANNEL, fiscalNoticeDedupeKey } from "./fiscal-notice.policy.js";

describe("the fiscal notice policy", () => {
  it("fixes the channel to email, because no setting decides it", () => {
    // The namespace's channel set is named for the reminder; stretching its meaning
    // for fiscal notices would change what a stored setting means without anybody
    // deciding that. Email is ungated, so every tenant has it.
    expect(FISCAL_NOTICE_CHANNEL).toBe("EMAIL");
  });

  it("keys the intent by document and channel", () => {
    expect(fiscalNoticeDedupeKey({ fiscalDocumentId: "doc-1", channel: "EMAIL" })).toBe(
      "fiscal:doc-1:EMAIL"
    );
  });

  it("is stable for one document and different per channel", () => {
    const first = fiscalNoticeDedupeKey({ fiscalDocumentId: "doc-1", channel: "EMAIL" });
    expect(fiscalNoticeDedupeKey({ fiscalDocumentId: "doc-1", channel: "EMAIL" })).toBe(first);
    expect(fiscalNoticeDedupeKey({ fiscalDocumentId: "doc-1", channel: "WHATSAPP" })).not.toBe(
      first
    );
    expect(fiscalNoticeDedupeKey({ fiscalDocumentId: "doc-2", channel: "EMAIL" })).not.toBe(first);
  });

  it("carries no contact datum", () => {
    expect(fiscalNoticeDedupeKey({ fiscalDocumentId: "doc-1", channel: "EMAIL" })).not.toMatch(/@/);
  });
});
