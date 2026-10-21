/**
 * Deliberate re-export shim ([[DEC-073]], [[IMP-001A]]).
 *
 * The Customer create contract now lives in `@newsaas/customers`, so the import
 * worker can validate with the SAME rules the API enforces. Everything this
 * module used to own is forwarded unchanged, which keeps the change a MOVE: the
 * implementation has one home, the API's import graph does not churn, and the
 * existing customer suite keeps importing from the path it always used with no
 * assertion touched.
 *
 * Collapsing this shim — repointing every importer at `@newsaas/customers` and
 * deleting this file — is a separate cleanup, deliberately not part of a move
 * that must change no behaviour.
 */
export * from "@newsaas/customers";
