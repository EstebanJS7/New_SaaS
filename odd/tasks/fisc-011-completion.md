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

_Recorded per work unit as it lands: commit identity, gate results, review
lineage._
