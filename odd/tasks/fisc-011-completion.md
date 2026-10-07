---
feature: fisc-011-completion
epic: EPIC-16
story: FISC-011
status: in-progress
created: 2026-10-07
branch: feat/epic-16-fisc-011-completion
---

# FISC-011 completion — the two unimplemented acceptance criteria

## Why this exists

FISC-011 is merged (PR #108, merge `ffd08a1`) and **not closed**: two acceptance
criteria are unimplemented, verified against the merged tree rather than
inferred from the checkboxes. The evidence is recorded in
`docs/02-stories/FISC-011-timbrado-and-numbering.md` (the two criteria marked
NOT IMPLEMENTED) and in `odd/tasks/epic-16-sifen-direct.md` (T7 `[~]`).

Nothing here reopens a decision. Both are ordinary additions to a surface that
already exists, and no schema change is needed: the column exists.

## WU-F — `series_started_at` is set once

**Contract.** Manual §10.5, quoted in baseline §13: _"Una vez que el SIFEN
reciba un DE con serie, se tomará la fecha y hora de firma digital del DE como
fecha inicial de inicio de la vigencia de la serie."_ The allocation cannot know
it (the number is part of the CDC and the CDC is signed afterwards), so the
series' start is recorded in a **second, set-once step** by the caller that has
just signed — [[FISC-012]].

**Shape.**

- `TimbradoRangeStore` (`packages/fiscal/src/timbrado/allocation.ts`) gains one
  operation: `setSeriesStart({ key, rangeId, startedAt }): Promise<boolean>` —
  `true` when this call set it, `false` when it was already set. Set-once is a
  predicate inside the UPDATE, never a read-then-write.
- The Prisma adapter (`apps/api/src/fiscal/timbrado/timbrado-range.store.ts`)
  puts the tenant in the `where` with the key and `seriesStartedAt: null` in the
  predicate.
- A guard rejects a `startedAt` that is not a usable instant, with a named
  failure code, rather than writing `Invalid Date`.

**Deliberately not a service method.** `allocateDocumentNumber` is not one
either: the port is implemented over the caller's transaction client, and the
calling surface belongs to FISC-012. Adding a service method here would create a
second, unowned path to the same write.

## WU-G — the profile's RUC is the certificate's RUC

**Contract.** Baseline §22.4, `D101` (Manual §7.2): _"Debe corresponder al RUC
del certificado digital utilizado para firmar el DE."_ And baseline §6 pins
where the RUC lives in the certificate:

```text
legal person    Subject -> SerialNumber, OID 2.5.4.5, format RUCXXXXXXXXX-X
natural person  SubjectAlternativeName -> SerialNumber, plus the employing
                entity's name and RUC
```

**Shape.**

- Pure, in `packages/fiscal/src/signing-material/certificate-ruc.ts` (beside the
  PKCS#12 boundary, same conventions: a `*Failure` union and an `*Error` class
  carrying `readonly failure`): read the certificate's RUC and compare it with
  the profile's `ruc` + `checkDigit`. A certificate whose RUC cannot be read is
  a **named refusal**, never a pass — the criterion says "enforced or refused,
  never silently accepted".
- API, both sides, so the invariant has no ordering hole:
  - the profile write (`timbrado.service.ts`, `saveProfile`) refuses a mismatch
    against every ACTIVE signing material of the tenant;
  - the material upload (`signing-material/signing-material.service.ts`) refuses
    a mismatch against an existing profile.
  - no ACTIVE material yet ⇒ the profile write has nothing to compare and
    proceeds; the upload is then the side that refuses.
- Refusals are `DomainError`s with the stable code the surface already uses
  (`VALIDATION_FAILED`), and the message is a new exported constant, mirroring
  `EXTRACTION_MESSAGES`.

## Gates

```text
pnpm --filter @newsaas/fiscal lint / typecheck / test / build
pnpm --filter @newsaas/database lint / typecheck / test / build
pnpm --filter @newsaas/api    lint / typecheck / test / build
pnpm lint / typecheck / test / build          (root)
pnpm format-check                             (whole repo, never scoped)
pnpm --filter @newsaas/api test:live-pg       (Docker; without ?schema=public)
```

## Evidence

**Both work units are implemented, committed and review-approved.** The Story
stays `in-progress` for one reason only: the live-PostgreSQL gate has not run.

```text
WU-F  d61bad4  the set-once series start, port op + adapter + three suites
WU-G  53e8bd2  the RUC obligation, both write paths + the pure reader
```

**Review.** One lineage, high tier, four lenses, `review-5c088696cf985684`:
review-risk, review-resilience, review-readability, review-reliability, then a
refuter and a targeted validator. It closed `approved` and the acknowledgement
burned the authority (target `sha256:175754d0…`).

**The refuter confirmed a real defect of mine, and the fix is in.** `R4-001`
(CRITICAL, resilience, inferential): `readRucFromSubjectAlternativeName` parsed
the whole SAN string for the first RUC-shaped token, but baseline §6 makes a
natural person's certificate carry **the employing entity's name and RUC** too,
so a certificate whose SAN holds the employer's RUC first would have been read
as the signer's — a silent acceptance, which is the exact failure the criterion
forbids. The parse now selects the `serialNumber` ENTRY and refuses unless there
is exactly one, and the hazardous ordering is a test that pins it. The
correction was submitted as a 120-line plan before editing, as the provider's
route requires.

The targeted validator is host-mediated and the Pi capture facade rejects its
binding (`capture-binding-rejected`); the route that works is
`gentle-ai review capture-validation --materialize`, run the role, then
`--input`. Same finding as FISC-011's earlier lineage.

**Non-blocking advisories the closure listed**, recorded as later work and never
as a reason to re-review this candidate: `R1-CERT-RUC-TOKEN` (risk, `WARNING`,
`certificate-ruc.ts`), `R2-001` (readability, `SUGGESTION`,
`certificate-ruc.ts`) and `R2-002` (readability, `SUGGESTION`,
`allocation.test.ts`). The closure's own output was truncated by a `head` in the
capture command, so any further advisory it listed is not recorded here — that
truncation is the defect, not a claim that there are only three.

```text
pnpm --filter @newsaas/fiscal lint / typecheck / test / build   green (267 tests)
pnpm lint / typecheck / test / build                            green (18/18, 18/18, 19/19, 11/11)
pnpm format-check                                               green
pnpm --filter @newsaas/api test:live-pg                         NOT RUN
```

**`test:live-pg` did not run: Docker is unavailable in this WSL distro** (the
`docker` CLI reports the Docker Desktop WSL integration is off, so the
`fisc009-pg` container on port 55433 is not reachable). The live-PostgreSQL case
this branch adds — the second `setSeriesStart` leaving the stored timestamp
untouched — is therefore unproven against a real database, and the Story cannot
close until it runs. Nothing else is outstanding.
