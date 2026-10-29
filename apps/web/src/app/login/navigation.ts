import { safeStaffReturnPath } from "@/lib/staff-return-path";

/** A new authenticated document needs its own CSP nonce and server-resolved tenant theme. */
export function navigateAfterSignIn(target?: string): void {
  window.location.assign(safeStaffReturnPath(target));
}
