export const FISCAL_PERMISSIONS = Object.freeze({ issue: "fiscal.invoice.issue" } as const);

export type FiscalPermission = (typeof FISCAL_PERMISSIONS)[keyof typeof FISCAL_PERMISSIONS];
