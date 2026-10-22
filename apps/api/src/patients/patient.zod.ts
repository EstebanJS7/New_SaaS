/**
 * Deliberate re-export shim ([[DEC-073]], [[IMP-001A]]).
 *
 * The Patient schemas now live in `@newsaas/patients`, so the import worker can
 * validate with the SAME rules the API enforces. The whole module moved, so
 * everything is forwarded unchanged: the implementation has one home, the API's
 * import graph does not churn, and the existing patient suite keeps importing
 * `createPatientBody` from the path it always used with no assertion touched.
 *
 * Collapsing this shim — repointing every importer at `@newsaas/patients` and
 * deleting this file — is a separate cleanup, deliberately not part of a move
 * that must change no behaviour.
 */
export * from "@newsaas/patients";
