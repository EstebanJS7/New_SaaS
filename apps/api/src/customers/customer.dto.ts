/**
 * Deliberate re-export shim ([[DEC-073]], [[IMP-001A]]).
 *
 * `CustomerResponse` now lives in `@newsaas/customers` beside the create
 * contract's response mapper, so the API's DTO shape and the shape a caller
 * outside a request reads cannot drift. Forwarding it here keeps every existing
 * importer working without a test diff.
 *
 * Collapsing this shim is a separate cleanup.
 */
export type { CustomerResponse } from "@newsaas/customers";
