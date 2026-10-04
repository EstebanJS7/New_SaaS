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

| #   | Range              | Lineage                   | Tier   | Lenses      | Outcome                                            |
| --- | ------------------ | ------------------------- | ------ | ----------- | -------------------------------------------------- |
| 1   | `b05d411..bc2d010` | `review-71824c524a5c9285` | low    | none        | approved on `START`                                |
| 2   | `bc2d010..a06033e` | `review-79b1daf60f30935c` | medium | reliability | approved                                           |
| 3   | `a06033e..27b48b2` | `review-f7839c7e4005e631` | medium | reliability | approved                                           |
| 4   | `27b48b2..cd6fd87` | `review-5f93fa36c0a8099f` | medium | reliability | approved                                           |
| 5   | `cd6fd87..295cba3` | `review-666627733d25cb22` | medium | reliability | approved                                           |
| 6   | `295cba3..0c99af1` | `review-7490892a52aa3fa8` | medium | reliability | approved                                           |
| 7   | `0c99af1..8c9e1c4` | `review-cfc13bac309f1db2` | low    | none        | approved on `START`                                |
| 8   | `8c9e1c4..ab3bad4` | `review-6d69b5d66f366ee1` | low    | none        | approved on `START`                                |
| 9   | `ab3bad4..e0d9661` | `review-d1cd99817d47a029` | medium | reliability | approved — closed the four recommended-first items |
| 10  | `e0d9661..6e14101` | `review-ca4223f8b8b7f32a` | low    | none        | approved on `START`                                |
| 11  | `6e14101..ceb22e3` | `review-67a69238826f76c7` | low    | none        | approved on `START`                                |

## Debt

Fifteen advisories, none blocking. Four are resolved and marked below; the
resolution is described under "Resolved — the four recommended-first items".

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

| Id                       | Severity   | Location                                                            |
| ------------------------ | ---------- | ------------------------------------------------------------------- |
| `R3-EXPIRY-BOUNDARY`     | WARNING    | `packages/fiscal/src/signing-material/pkcs12.ts:243` — **resolved** |
| `R3-NOTBEFORE-UNCHECKED` | WARNING    | `packages/fiscal/src/signing-material/pkcs12.ts:244` — **resolved** |
| `R3-PASSWORD-PREEMPTION` | SUGGESTION | `packages/fiscal/src/signing-material/pkcs12.ts:134`                |
| `R3-PLAIN-KEY-UNCHECKED` | WARNING    | `packages/fiscal/src/signing-material/pkcs12.ts:190`                |

**Two of these deserve early attention rather than later**, because they are
correctness edges in the certificate check rather than style:

- `R3-NOTBEFORE-UNCHECKED`: a certificate whose `notBefore` is in the future is
  accepted. Signing with it would fail at DNIT, so refusing it at upload is
  strictly better than discovering it at emission.
- `R3-EXPIRY-BOUNDARY`: the expiry comparison's boundary semantics
  (`validToDate <= now`) are not covered by a test at the exact instant.

### From `review-666627733d25cb22` — the aggregate

| Id     | Severity | Location                                            |
| ------ | -------- | --------------------------------------------------- |
| `R3-1` | WARNING  | `packages/fiscal/src/index.ts:61-73` — **resolved** |

This is the one worth acting on first: the package's **public index exports the
PKCS#12 test fixture builder and its material** (`buildTestPkcs12`, `TEST_*`
constants, `testCertificateDer`, `testPrivateKeyPkcs8Der`). Nothing outside
tests imports them, and `@newsaas/fiscal` already exports its fake provider with
a "dev/test only" comment, so this is precedent-consistent — but it does ship
test scaffolding in the package's public surface, and a subpath export
(`@newsaas/fiscal/testing`) would be the cleaner boundary.

### From `review-7490892a52aa3fa8` — the HTTP surface

| Id                            | Severity   | Location                                                                                                                                                |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R3-FSTPART-CODEPREFIX`       | WARNING    | `apps/api/src/fiscal/signing-material/signing-material.pipe.ts:88-95` — **resolved**                                                                    |
| `R3-NO-PROD-SIZE-CODE-TEST`   | WARNING    | `apps/api/src/fiscal/signing-material/signing-material.integration.test.ts:74-86`                                                                       |
| `R3-STORE-FIELD-NOT-ASSERTED` | SUGGESTION | `apps/api/src/fiscal/signing-material/signing-material.integration.test.ts:50-67` — **resolved** (the service test now asserts the row's exact key set) |

`R3-FSTPART-CODEPREFIX` is the fragile one: the pipe decides "this is the
multipart size error" by checking that the thrown error's `code` **starts with
`FST_PART`**. A Fastify version that renames its error codes would silently turn
a `413` into a `500`, and the existing test does not pin the production code
path (`R3-NO-PROD-SIZE-CODE-TEST`).

## Resolved — the four recommended-first items

Closed on 2026-10-04, before [[FISC-008]] grew `@newsaas/fiscal`'s public
surface, because all four live in files the next stories touch.

**`R3-NOTBEFORE-UNCHECKED` — resolved.** `extractSigningMaterial` now enforces
both ends of the validity window: a certificate whose `validFromDate` is in the
future fails with the new `CERTIFICATE_NOT_YET_VALID` reason and its own
operator message, instead of being accepted and discovered at the first
signature.

**`R3-EXPIRY-BOUNDARY` — resolved.** The window is now pinned as inclusive at
the start and exclusive at the end, and a test proves all four instants: one
millisecond before `notBefore` is refused, exactly at `notBefore` is usable, one
millisecond before `notAfter` is usable, exactly at `notAfter` is expired.

**`R3-1` — resolved.** The PKCS#12 fixture moved out of the package index into a
test-only entry point: `packages/fiscal/src/testing.ts`, reachable as
`@newsaas/fiscal/testing` through a new `exports` subpath. Test scaffolding is
no longer part of the package's public contract.

**`R3-FSTPART-CODEPREFIX` — resolved, with the advisory's premise corrected.**
The premise was that a renamed Fastify error code would turn a size refusal into
a 500. It would not, and this was verified rather than argued: with the old
`FST_PART` prefix check in place, `@fastify/multipart`'s
`FST_REQ_FILE_TOO_LARGE` propagated unmapped to the API's error handler, which
already rendered it as a `413 PAYLOAD_TOO_LARGE` envelope. The status was never
at risk.

What _was_ true: the prefix check caught only `FST_PARTS_LIMIT` out of the four
413 codes `@fastify/multipart` raises, so the mapping was dead for the case it
was written for, and the response carried the generic wording rather than the
domain's. Detection now uses `statusCode === 413`, which is what
`@fastify/error` sets alongside `code`, and a test asserts the **message**
rather than the status — because the status alone cannot distinguish a mapped
refusal from a propagated one. Reverting the fix makes that test fail with
`"Request payload is too large."`, which is the proof.

### From `review-d1cd99817d47a029` — the advisory-closing commit

| Id                          | Severity   | Location                                                           |
| --------------------------- | ---------- | ------------------------------------------------------------------ |
| `R3-MULTIPART-STATUS-BROAD` | SUGGESTION | `apps/api/src/fiscal/signing-material/signing-material.pipe.ts:96` |
| `R3-VALIDFROM-BOUND`        | SUGGESTION | `packages/fiscal/src/signing-material/pkcs12.ts:252`               |

`R3-MULTIPART-STATUS-BROAD` is the fair critique of the fix above: reading
`statusCode === 413` is deliberately broad, so _any_ 413 from _any_ source
inside the pipe would be reported as "the container exceeds the maximum allowed
upload size". On this route the only 413 sources are the four multipart size
limits, so the wording is accurate today — but that is an assumption rather than
a check, and the tighter form (match the four `FST_*` size codes, with the
status as a fallback) would say what it means.

## Termination of the review record

Eleven candidates closed before this note was written, and the coverage is
complete from `b05d411` to `ceb22e3`.

Recording a closure is itself a docs change, so every recording commit is an
unreviewed candidate in turn. The regress is terminated deliberately: the commit
that carries **this** note is a docs-only candidate, closed separately as a
low-tier `non_executable_only` review, and it is **not** recorded here again.
Further edits to this file to record that closure are out of scope by
construction.

## Disposition

**Four of fifteen resolved**; eleven remain accepted as debt. None of the
fifteen invalidated an acceptance criterion and none blocked FISC-007's closure.

The eleven remaining are the two `secret-store` findings (`R3-001`, `R3-002`),
`R3-003`, `R3-secrets-module-prod-guard`, `R3-apienv-superrefine-scope`,
`R3-PASSWORD-PREEMPTION`, `R3-PLAIN-KEY-UNCHECKED`, `R3-NO-PROD-SIZE-CODE-TEST`
(partly overtaken: the size mapping now has a message-level test through the
production path), `R3-MULTIPART-STATUS-BROAD` and `R3-VALIDFROM-BOUND`. They are
lower-value: style, defence-in-depth scoping, and test-shape suggestions.

Scheduling is not fixed here. [[FISC-009]] will sign with this material, so it
is the natural moment to re-read `R3-PLAIN-KEY-UNCHECKED` and the two
`secret-store` findings; [[FISC-013]] re-validates the extraction against a real
PSC container.
