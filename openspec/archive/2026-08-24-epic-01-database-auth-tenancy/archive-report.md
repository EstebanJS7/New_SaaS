```yaml
schema: gentle-ai.archive-result/v1
change: epic-01-database-auth-tenancy
archived: 2026-08-24
verdict_ref: >-
  PASS-WITH-AUTHORIZED-DEFERRALS (pass_with_warnings) — verify-report.md in this
  folder; 24/24 requirements, 46/46 scenarios, 0 blockers
commit_range: 08a2ef8..27959d5
destination: openspec/archive/2026-08-24-epic-01-database-auth-tenancy/
task_completion:
  8/8 phases, all implementation checkboxes complete at archive time
```

# Archive Report — epic-01-database-auth-tenancy

## Closure

EPIC-01 Database / Auth / Tenancy closed on 2026-08-24 with verdict
PASS-WITH-AUTHORIZED-DEFERRALS (`pass_with_warnings`, 0 blockers): 24/24
requirements and 46/46 scenarios verified across the five delta specs, zero
orphans against the tasks traceability table. Per [[DEC-001]], `docs/` is the
permanent truth and this OpenSpec folder is the temporary trace, preserved
verbatim under `openspec/archive/2026-08-24-epic-01-database-auth-tenancy/`.

## Commit range `08a2ef8..27959d5`

| Commit    | Batch / units          | Delivered                                               |
| --------- | ---------------------- | ------------------------------------------------------- |
| `afeb153` | B1 / U2 (2.1)          | Prisma foundation, lifecycle, CI migrations gate        |
| `b2abd53` | B1 / U3–U4 (2.2–2.3)   | Staff identity + tenancy core schema                    |
| `de9aae3` | B1                     | Batch 1 task bookkeeping                                |
| `87c6fb6` | B2 / U5 (2.4)          | RBAC, entitlements and audit schema                     |
| `d60615c` | B2 / U17 (6.1)         | Idempotent reference seed                               |
| `7a92fd4` | B3 / U6 (3.1)          | Frozen error registry + DomainError                     |
| `89411ea` | B3 / U7–U9 (3.2–3.4)   | Error envelope, request-id propagation, readiness       |
| `2d431f5` | B4 / U10–U13 (4.1–4.4) | First-party staff auth (argon2id, PG sessions, limiter) |
| `d8cc17e` | B4                     | DEC-002 proposal + TD-005 record                        |
| `0408510` | B5 / U14–U16 (5.1–5.3) | Tenancy enforcement + cross-tenant isolation proof      |
| `ec21eb0` | B6 / U18 (6.2–7.1)     | Audit writer, entitlements boundary, transport baseline |
| `961353b` | B7                     | Module docs sync + roadmap reconcile                    |
| `27959d5` | B7                     | Strict config test timeout hardening                    |

## Implemented

All 8 phases / 18 work units: persistence foundation (migrations 001–003 with
conventions/inventory tests), API contract baseline (error registry/envelope,
request-id structured logs, `/health/ready`, CORS/security headers), staff auth
(argon2id credentials, revocable PostgreSQL sessions, hardened cookie semantics,
login rate limiter), tenancy core (`TenantActiveGuard`, tenant-safe repository,
cross-tenant `404` suite with byte-equivalence fence), seeds (idempotent
reference seed, guarded demo seed), audit + entitlements boundary (append-only
writer, `has()` truth table). Module docs shipped under `docs/05-modules/`;
roadmap acceptance criteria ticked with evidence pointers.

## Authorized deferrals (formal records — not failures)

- [[TD-004]] — password reset/forgot-password deferred (blocked on EPIC-17 email
  delivery); recovery routes return a `404` envelope meanwhile.
- [[TD-005]] — login rate limiter is single-replica by design; shared-store
  revision required before horizontal scaling.
- [[TD-006]] — isolation suites run over an in-memory Prisma boundary;
  live-PostgreSQL execution lands with the CI migrations job.

## Pending gates (open at archive — flagged honestly)

1. **DEC-002 acceptance (human)** — API route-prefix convention stays
   `proposed`; shipped routes are unprefixed `/auth/*`.
2. **CI-run confirmation (push-gated)** — the `migrations` job (fresh-PG16
   `migrate deploy` + double-seed probe) and the isolation-suite quality job
   must execute in a real CI run.
3. **Docker preflight (when available)** — compose services/preflight execution
   was unavailable to apply/verify environments; deferred to the maintainer push
   flow.

Because of (1)–(2), EPIC-01 remains `status: in-progress` with Exit Criteria
unchecked in `docs/01-roadmap/EPIC-01-Database-Auth-Tenancy.md`. This archive
does NOT mark the epic done.

## Relocation

`openspec/changes/epic-01-database-auth-tenancy/` →
`openspec/archive/2026-08-24-epic-01-database-auth-tenancy/` via `git mv`;
byte-identity proven by recursive `diff -r` against a pre-move snapshot (empty
output). Nothing deleted; audit trail preserved per `openspec/config.yaml`
`rules.archive`.
