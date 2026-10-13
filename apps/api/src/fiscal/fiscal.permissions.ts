// FISC-005b (D7): read-wide access is separate from the issuing command.
export const FISCAL_PERMISSIONS = Object.freeze({
  issue: "fiscal.invoice.issue",
  read: "fiscal.read",
  signingMaterialManage: "fiscal.signing_material.manage",
  // FISC-011: configuring the emitter profile and its numbering ranges. Separate
  // from `signingMaterialManage` because it is a different material and a
  // different blast radius: a range's counter cannot be lowered once used.
  profileManage: "fiscal.profile.manage",
  // FISC-016 WU-D: voiding a range's remaining numbers. Deliberately NOT the
  // issuing key and not the profile-management key either: this is the one range
  // operation that reaches the tax administration, it cannot be undone, and a
  // caller trusted to configure numbering is not automatically trusted to tell
  // SIFEN those numbers will never be used.
  rangeVoid: "fiscal.range.void",
} as const);

export type FiscalPermission = (typeof FISCAL_PERMISSIONS)[keyof typeof FISCAL_PERMISSIONS];
