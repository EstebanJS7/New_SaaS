## Recovery: S1 Customer persistence artifacts restored (2026-09-01)

After the S1 scope separation removed the untracked EPIC-04 persistence
artifacts, the exact recovery sources from audit observation #1764 were applied:

| Restored path | Source | SHA-256 | Lines |
| ------------- | ------ | ------- | ----: |
| `packages/database/prisma/migrations/20260826150100_customers/migration.sql` | OpenCode record `prt_05fea29b6001F4LdbNIN42yLRX` | `ca418ba457cf6bc8fbd276811748c2cbc42090c036c409be664e18ea0bb2a83b` | 109 |
| `packages/database/src/schema-branding-customers.test.ts` | OpenCode record `prt_05fea25c1001xCO0DFb06d6YIb` | `9f097c5f660f1cb58f74b15e2693a015805058fbfbad33075163b99bac1bf171` | 107 |
| `packages/database/prisma/schema.prisma` Customer models/enums/Tenant relations | `/tmp/opencode/epic03-branding-slice-candidate.diff` (S1 separation evidence) | n/a — applied as delta | +CustomerKind, +CustomerContactKind, +Customer, +CustomerAddress, +CustomerContact, +PatientGuardian, +4 Tenant relation fields |
| `packages/database/src/reference-seed.ts` Customer permissions/role matrix | `/tmp/opencode/epic03-branding-slice-candidate.diff` (S1 separation evidence) | n/a — applied as delta | +6 `customers.*` permission seeds, +matrix entries |
| `packages/database/src/reference-seed.test.ts` Customer role-matrix test delta | `/tmp/opencode/epic03-branding-slice-candidate.diff` (S1 separation evidence) | n/a — applied as delta | +customer baseline matrix assertion, permissions count 8→14 |

Focused verification performed:

- `sha256sum` confirmed the two OpenCode-restored files match the audit hashes.
- `DATABASE_URL=postgresql://localhost:5432/postgres pnpm --filter @newsaas/database exec prisma validate --schema=prisma/schema.prisma` reported **The schema at prisma/schema.prisma is valid 🚀**.

No `prisma generate`, broad test run, root gates, or CI execution was performed.
