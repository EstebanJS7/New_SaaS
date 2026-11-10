import type { CapabilityRequirement } from "@/lib/capabilities";

/**
 * What each fiscal-document command needs ([[UX-037]]). UX only: the API stays
 * the authority. Source: apps/api/src/fiscal/fiscal.controller.ts — both
 * `POST /fiscal-documents` and `POST /fiscal-documents/:id/cancel` require
 * `FISCAL_PERMISSIONS.issue` (`fiscal.invoice.issue`); FiscalService asserts the
 * `fiscal` entitlement first.
 */
export const FISCAL_ACTIONS = {
  /** Any fiscal screen: the entitlement every fiscal-document call asserts first. */
  enabled: { feature: "fiscal" },
  issue: { permission: "fiscal.invoice.issue", feature: "fiscal" },
  cancel: { permission: "fiscal.invoice.issue", feature: "fiscal" },
} as const satisfies Record<string, CapabilityRequirement>;
