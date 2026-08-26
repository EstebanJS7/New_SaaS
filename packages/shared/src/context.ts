/**
 * Server-derived request context carried across the request lifecycle
 * (design D3).
 *
 * The API never trusts client-supplied identity: every field below is filled
 * exclusively by server code — the request-id seam at the edge, and guards
 * afterwards. Handlers read identity through {@link RequestContext} instead
 * of request bodies, query strings, or headers.
 *
 * Population is progressive: the ALS store starts with `requestId` only, and
 * the AuthGuard adds `userProfileId`; tenant fields land with the tenancy
 * slice (Batch 5). Presence guarantees for private routes are therefore
 * enforced by accessor contracts (`requireUserProfileId()` /
 * `requireTenantId()`), not by making fields non-optional — the type must stay
 * truthful about partially-populated states between middleware and guards.
 */
export interface RequestContext {
  /** Correlation ID minted or adopted by the request-id seam (design D7). */
  readonly requestId: string;

  /** Authenticated staff profile; set by AuthGuard after session validation. */
  readonly userProfileId?: string;

  /**
   * Active tenant, derived ONLY from the session's membership — never from
   * client hints. Populated by TenantActiveGuard (tenancy slice).
   */
  readonly tenantId?: string;

  /** Membership row backing the tenant claim (audit + repository scoping). */
  readonly membershipId?: string;

  /**
   * Role row bound to the membership — the EPIC-02 enforcement key: the
   * PermissionGuard resolves the permission key set from this id
   * (`role_permission` join). Never client-supplied.
   */
  readonly roleId?: string;

  /** Role code bound to the membership; policy evaluation lands in EPIC-02. */
  readonly roleCode?: string;
}
