// FISC-005b (D7): read-wide access is separate from the issuing command.
export const FISCAL_PERMISSIONS = Object.freeze({
  issue: "fiscal.invoice.issue",
  read: "fiscal.read",
  signingMaterialManage: "fiscal.signing_material.manage",
} as const);

export type FiscalPermission = (typeof FISCAL_PERMISSIONS)[keyof typeof FISCAL_PERMISSIONS];
