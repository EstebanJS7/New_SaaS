---
id: TD-031
type: tech-debt
title: FISC-007 signing-material review advisories
status: open
severity: medium
related_epics:
  - EPIC-16
related_stories:
  - FISC-007
created: 2026-10-04
updated: 2026-10-04
---

# TD-031 — FISC-007 signing-material review advisories

## Context

FISC-007's native review closed as a **chain of six approved candidates**, one
per work unit, because the whole slice (5229 insertions across 52 files) is far
over the reviewer's context budget. Two of the six closed on the `START` call
itself (`risk_tier: low`, no lenses); the other four each ran one
`review-reliability` lens.

Every candidate closed **approved**, so the receipt stands for each. The
findings below are **non-blocking**: none opened a correction, none reopens its
review, and no correction transition is offered for any of them. They are
recorded here as separate later work — and never as a reason to re-run a review
on a candidate that already closed.

The provider reports each finding's identifier, lens, location, severity and
disposition. It does not return the finding's prose, so the descriptions below
name what the identifier and the location point at; the reviewer's own artifact
inside the lineage record is the authoritative wording.

## The chain

| #   | Range              | Lineage                   | Tier   | Lenses      | Outcome             |
| --- | ------------------ | ------------------------- | ------ | ----------- | ------------------- |
| 1   | `b05d411..bc2d010` | `review-71824c524a5c9285` | low    | none        | approved on `START` |
| 2   | `bc2d010..a06033e` | `review-79b1daf60f30935c` | medium | reliability | approved            |
| 3   | `a06033e..27b48b2` | `review-f7839c7e4005e631` | medium | reliability | approved            |
| 4   | `27b48b2..cd6fd87` | `review-5f93fa36c0a8099f` | medium | reliability | approved            |
| 5   | `cd6fd87..295cba3` | `review-666627733d25cb22` | medium | reliability | approved            |
| 6   | `295cba3..0c99af1` | `review-7490892a52aa3fa8` | medium | reliability | approved            |
| 7   | `0c99af1..8c9e1c4` | `review-cfc13bac309f1db2` | low    | none        | approved on `START` |

## Debt

Thirteen advisories, none blocking:

### From `review-79b1daf60f30935c` — `packages/secret-store`

| Id       | Severity   | Location                                                   |
| -------- | ---------- | ---------------------------------------------------------- |
| `R3-001` | WARNING    | `packages/secret-store/src/envelope-secret-store.ts:76-86` |
| `R3-002` | WARNING    | `packages/secret-store/src/secret-store.port.ts:37-42`     |
| `R3-003` | SUGGESTION | `packages/secret-store/src/secret-envelope.ts:97-98`       |

### From `review-f7839c7e4005e631` — persistence and the composition root

| Id                             | Severity   | Location                                            |
| ------------------------------ | ---------- | --------------------------------------------------- |
| `R3-secrets-module-prod-guard` | WARNING    | `apps/api/src/secret-store/secrets.module.ts:33-34` |
| `R3-apienv-superrefine-scope`  | SUGGESTION | `apps/api/src/config/api-env.schema.ts:166-176`     |

### From `review-5f93fa36c0a8099f` — the PKCS#12 boundary

| Id                       | Severity   | Location                                             |
| ------------------------ | ---------- | ---------------------------------------------------- |
| `R3-EXPIRY-BOUNDARY`     | WARNING    | `packages/fiscal/src/signing-material/pkcs12.ts:243` |
| `R3-NOTBEFORE-UNCHECKED` | WARNING    | `packages/fiscal/src/signing-material/pkcs12.ts:244` |
| `R3-PASSWORD-PREEMPTION` | SUGGESTION | `packages/fiscal/src/signing-material/pkcs12.ts:134` |
| `R3-PLAIN-KEY-UNCHECKED` | WARNING    | `packages/fiscal/src/signing-material/pkcs12.ts:190` |

**Two of these deserve early attention rather than later**, because they are
correctness edges in the certificate check rather than style:

- `R3-NOTBEFORE-UNCHECKED`: a certificate whose `notBefore` is in the future is
  accepted. Signing with it would fail at DNIT, so refusing it at upload is
  strictly better than discovering it at emission.
- `R3-EXPIRY-BOUNDARY`: the expiry comparison's boundary semantics
  (`validToDate <= now`) are not covered by a test at the exact instant.

### From `review-666627733d25cb22` — the aggregate

| Id     | Severity | Location                             |
| ------ | -------- | ------------------------------------ |
| `R3-1` | WARNING  | `packages/fiscal/src/index.ts:61-73` |

This is the one worth acting on first: the package's **public index exports the
PKCS#12 test fixture builder and its material** (`buildTestPkcs12`, `TEST_*`
constants, `testCertificateDer`, `testPrivateKeyPkcs8Der`). Nothing outside
tests imports them, and `@newsaas/fiscal` already exports its fake provider with
a "dev/test only" comment, so this is precedent-consistent — but it does ship
test scaffolding in the package's public surface, and a subpath export
(`@newsaas/fiscal/testing`) would be the cleaner boundary.

### From `review-7490892a52aa3fa8` — the HTTP surface

| Id                            | Severity   | Location                                                                          |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `R3-FSTPART-CODEPREFIX`       | WARNING    | `apps/api/src/fiscal/signing-material/signing-material.pipe.ts:88-95`             |
| `R3-NO-PROD-SIZE-CODE-TEST`   | WARNING    | `apps/api/src/fiscal/signing-material/signing-material.integration.test.ts:74-86` |
| `R3-STORE-FIELD-NOT-ASSERTED` | SUGGESTION | `apps/api/src/fiscal/signing-material/signing-material.integration.test.ts:50-67` |

`R3-FSTPART-CODEPREFIX` is the fragile one: the pipe decides "this is the
multipart size error" by checking that the thrown error's `code` **starts with
`FST_PART`**. A Fastify version that renames its error codes would silently turn
a `413` into a `500`, and the existing test does not pin the production code
path (`R3-NO-PROD-SIZE-CODE-TEST`).

## Disposition

All thirteen are **accepted as debt**. None invalidates an acceptance criterion
and none blocks FISC-007's closure. The two certificate-check edges
(`R3-NOTBEFORE-UNCHECKED`, `R3-EXPIRY-BOUNDARY`) and the fixture export (`R3-1`)
are the recommended first three when this item is scheduled; the `FST_PART`
code-prefix dependency is the recommended fourth.

Scheduling is not fixed here. [[EPIC-16]]'s later stories touch the same files
([[FISC-009]] will sign with this material and [[FISC-013]] will re-validate the
extraction against a real PSC container), so the natural moment to close the
certificate-check edges is FISC-009, and the fixture-export boundary is a
one-line change whenever the package's public surface is next touched.
