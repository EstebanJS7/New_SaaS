import type { RoleCode } from "@newsaas/database";

/**
 * Administrator-class roles whose ACTIVE memberships can never be demoted to
 * zero within a tenant (EPIC-02 design D3 last-administrator rule). Fixed
 * seed codes by design: elevation is data, but WHICH roles count as
 * administrators is a product invariant from PRD §9.
 */
export const ADMIN_CLASS_ROLE_CODES: readonly RoleCode[] = ["OWNER", "ADMIN"];
