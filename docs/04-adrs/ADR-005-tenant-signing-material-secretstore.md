---
id: ADR-005
type: adr
title: Tenant signing material behind a SecretStore boundary
status: accepted
date: 2026-10-04
supersedes: []
superseded_by:
related_epics:
  - EPIC-16
related_decisions:
  - DEC-042
  - DEC-048
  - DEC-053
related_stories:
  - FISC-007
approval_record:
  decision_proposal: DEC-053
  decision_status: accepted
  decision_approval_date: 2026-10-04
  adr_gate_authority:
    DEC-053 Decision section plus docs/99-governance/DOCUMENTATION-RULES.md
    "change Fiscal Provider boundary"
  adr_acceptance_basis:
    the maintainer chose options A/A/A on 2026-10-04 (envelope encryption in
    PostgreSQL; PKCS#12 plus password as the operator artifact; audited staff
    API routes), and DEC-053 records the derived consequence D4 (the password is
    never persisted)
---

# ADR-005 — Tenant signing material behind a `SecretStore` boundary

## Decision Summary

[[EPIC-16]] makes us the electronic issuer, so a tenant's **signing private key
enters our boundary**. This ADR introduces a reusable `SecretStore` platform
capability that holds tenant secret material encrypted at rest, and changes what
the Fiscal boundary owns: it now holds RESTRICTED material and must guarantee it
is never logged, never returned and never reachable from a Git file.

| Surface                                          | This ADR                                 | Explicitly out of scope             |
| ------------------------------------------------ | ---------------------------------------- | ----------------------------------- |
| `packages/secrets` port, drivers, module         | Added                                    | —                                   |
| `tenant_secret` table (ciphertext at rest)       | Added                                    | —                                   |
| `tenant_fiscal_signing_material` table           | Added                                    | —                                   |
| Fiscal upload / list / retire routes             | Added, behind a new permission           | A web UI for them (FISC-007 is API) |
| `SECRET_STORE_MASTER_KEYS` + key-ring resolution | Added, refused in production when absent | A rewrap command (future work)      |
| XAdES signing and the `SIGNING` lifecycle state  | Untouched                                | [[FISC-009]]                        |
| Timbrado, numbering, DNIT web services           | Untouched                                | [[FISC-011]], [[FISC-010]]          |
| `FiscalDocument` lifecycle and transition guard  | Untouched                                | —                                   |
| `FISCAL_PROVIDER` selection                      | Untouched (still `"fake"` only)          | [[FISC-012]]                        |
| KuDE layout, portal surface, reports             | Untouched                                | [[TD-022]], [[EPIC-18]]             |
| PRD                                              | Untouched                                | —                                   |

## Context

[[EPIC-15]] built the Fiscal boundary around an opaque credential reference
([[DEC-042]], [[DEC-048]]) while a deterministic fake stood in for the provider.
Nothing in the repository can hold a private key: there is no secret store, no
encrypted column, and no fiscal credential mechanism.

The retarget to SIFEN Direct removed the option that made this cheap. With a
commercial provider the certificate stays with the vendor and we hold an API
key; with SIFEN Direct we hold the PSC-issued certificate's private key, and we
sign every DTE ourselves. `docs/06-fiscal/SIFEN-BASELINE.md` pins the material's
shape from the official source: an X.509 v3 certificate from a PSC habilitado
por el MIC, type **F1 = firma digital por software**, used **both** to sign data
messages **and** to authenticate mutual TLS. The same certificate, two uses.

`docs/99-governance/ENGINEERING-RULES.md` already says: "Secrets never live in
Git or plaintext application records."
`docs/99-governance/DOCUMENTATION-RULES.md` names "change Fiscal Provider
boundary" as an explicit ADR case. Both apply.

## Why an ADR is Required

- The Fiscal provider boundary's **responsibility set changes**: it gains
  custody of RESTRICTED material, which was previously outside it.
- The change introduces a **reusable platform capability consumed by more than
  one domain in principle** (the Fiscal vertical today; a future domain
  tomorrow), which is exactly the class `AGENTS.md` gates behind an ADR.
- Custody of a private key is a **durable operational commitment** — backup,
  custody, loss and rotation — not a feature toggle.
- A Decision alone is insufficient because the choice is architectural and
  expected to outlive FISC-007.

## Decision

**D1 — A `SecretStore` port, with drivers in a package and selection in the
application.** The shape mirrors `@newsaas/storage`, which is the repository's
existing precedent for a platform capability behind a port:

```ts
export interface SecretStore {
  put(args: {
    tenantId: string;
    key: string;
    value: string;
  }): Promise<{ key: string }>;
  get(args: { tenantId: string; key: string }): Promise<string>;
  delete(args: { tenantId: string; key: string }): Promise<void>; // idempotent
  has(args: { tenantId: string; key: string }): Promise<boolean>;
}
```

`tenantId` is a **scoping dimension, not semantics**: the port stays opaque and
never learns what a secret means. A `get` whose tenant does not match the stored
row fails exactly as a missing key does, so a wrong tenant cannot be
distinguished from an absent secret.

**D2 — Envelope encryption in PostgreSQL.** A platform master key (KEK) is
supplied by environment. Each stored secret gets a random data key; the data key
encrypts the material with **AES-256-GCM**; the data key is itself wrapped by
the master key. The row stores the wrapped data key, the IV, the authentication
tag, the algorithm and the master-key version. **No plaintext, and no
ciphertext, is written anywhere but our own database** — no Git file, no tenant
setting, no object storage, no log.

**D3 — A versioned key ring, so a KEK can be rotated.**
`SECRET_STORE_MASTER_KEYS` is a versioned list of base64-encoded 32-byte keys
and `SECRET_STORE_MASTER_KEY_VERSION` names the current one. New writes use the
current version; reads use the version recorded in the row. A row encrypted
under version 1 therefore keeps decrypting after version 2 becomes current,
without a data migration. A rewrap command is **out of scope** and recorded as a
limitation, not implied by the presence of the version column.

**D4 — The production gate refuses to boot without the master key.**
`apiEnvSchema`'s `superRefine` rejects a missing or short master key when
`NODE_ENV === "production"`, and the module factory refuses to fall back to the
in-memory driver there — the same duplicated refusal `resolveFiscalProvider`
already uses. A test-only driver must never be selectable silently in
production.

**D5 — The certificate is metadata; the private key is RESTRICTED material.**
The `tenant_fiscal_signing_material` row carries the certificate itself and its
public metadata (subject, holder RUC, serial, validity window, key algorithm),
all INTERNAL, plus an **opaque `credentialRef`** into the `SecretStore` holding
the private key. Fiscal records never contain the private key.

**D6 — The password never persists.** The operator's artifact is a PKCS#12 plus
its password ([[DEC-053]]/D2). The upload decrypts it in memory, validates the
password, extracts the certificate and the private key, and forgets the
password. This is [[DEC-053]]/D4 and it is restated here because it is a
boundary property: **the number of stored secrets per signing material is
exactly one.**

**D7 — Retirement is an explicit business operation, not a delete.**
`docs/03-architecture/REVERSALS-CORRECTIONS.md` applies to credential rotation
as much as to money: a material moves `ACTIVE → RETIRED` with an actor, a
timestamp and a reason, and the row stays. A partial unique index permits at
most one `ACTIVE` row per `(tenantId, environment)`. Loading a new material
retires the current one **in the same transaction**, which is what rotation
means here.

**D8 — Nothing in the boundary may leak the material.** The private key is never
returned by any DTO, never placed in `AuditLog.metadata`, never interpolated
into an error message, and never written to a log — including the failure paths.
The audit row carries identifiers only: event name, material id, environment,
certificate serial, outcome. The snapshot sanitizer's fail-closed posture
([[DEC-050]]) is the precedent, and this boundary is stricter because the
material is a key, not a document.

**D9 — The `SecretStore` is tenant-scoped at the database level.** The
`tenant_secret` row carries the owning `tenantId` with a `RESTRICT` foreign key,
and every read filters on it. A key-only design was rejected: a bug in key
composition would then be a cross-tenant read, and defence in depth is cheap
here.

## Alternatives Considered

- **An external secret manager as the only production driver** ([[DEC-053]]
  Option B) — rejected: it makes every deployment, including self-hosted ones,
  depend on a custody service this epic does not otherwise need, and it cannot
  boot without one. The port leaves the door open for it later.
- **The port plus both drivers now** ([[DEC-053]] Option C) — rejected: two
  production paths to build, test and document with no story requiring the
  second.
- **Store the PKCS#12 container and its password, and decrypt at signing time**
  — rejected: it doubles the stored secret material, keeps a password alive for
  the lifetime of the material, and turns every signing call into a decryption
  of a container instead of a read of a key. The derived consequence is D6.
- **Put the certificate in object storage next to the XML artifacts** —
  rejected: the certificate is needed on every signing call and is small; an
  object-store round trip (or a signed-URL indirection) per emission buys
  nothing. The XML and KuDE artifacts, which are large and per-document, stay in
  `@newsaas/storage`.
- **A generic EAV "credential" table with a configurable provider mapping** —
  rejected outright by `AGENTS.md`; SIFEN Direct is one concrete protocol.
- **Encrypt with the master key directly, with no per-secret data key** —
  rejected: it makes a KEK rotation a full data migration and makes the version
  column meaningless. A wrapped data key per secret is the smaller long-term
  cost.
- **An operator CLI instead of HTTP** ([[DEC-053]] Option B on axis 3) —
  rejected: it bypasses RBAC, audit and tenant isolation while remaining
  callable by anyone with a shell.

## Consequences

### Positive

- The material is unreadable without the master key, and the master key is not
  in Git.
- The port is reusable: a second domain needing a tenant secret gets the same
  boundary ([[DEC-053]] records it as a platform capability, as `AGENTS.md`
  requires).
- Rotation of the signing material is one audited operation; rotation of the KEK
  is a configuration change plus an optional rewrap.
- The certificate's validity window becomes observable metadata, so expiry can
  be surfaced before it breaks emission.
- The password has no lifetime in the system at all.

### Negative

- **We own key custody.** Losing `SECRET_STORE_MASTER_KEYS` makes every stored
  private key unrecoverable, and an unrecoverable signing key means an unable
  issuer. Backup and custody of that value are an operational requirement
  recorded in the Story, not something the code can fix.
- The master key is an environment value, so it is readable by anyone who can
  read the process environment. This is the same trust posture the repository
  already accepts for the branding asset signed-URL secret and the database URL.
- A new table holds ciphertext whose format is a compatibility surface: changing
  the algorithm or the wrapping requires versioning, which is why the version
  column exists from the first migration rather than being added later.
- The API's multipart surface grows a second upload path, with its own size
  ceiling and validation.

## Migration / Rollout

1. **Additive migration.** Two tables (`tenant_secret`,
   `tenant_fiscal_signing_material`), two enums and one partial unique index. No
   existing table is altered, so no data migration and no backfill.
2. **Environment.** `SECRET_STORE_MASTER_KEYS` and
   `SECRET_STORE_MASTER_KEY_VERSION` are optional in development (the in-memory
   driver is used) and **required in production** by `apiEnvSchema`'s
   `superRefine` gate.
3. **No feature flag.** The capability is inert until a tenant loads a material;
   loading requires the new permission.
4. **Rollback.** Drop both tables and both enums. Material loaded before a
   rollback is re-loadable from the operator's PKCS#12, because the source
   artifact never leaves the operator's hands.
5. **Live-PostgreSQL coverage** is required for the partial unique index, the
   tenant-scoped read and the FK behaviour — a Prisma-only unit test cannot
   prove an index.

## Guardrails

- The private key and the password are RESTRICTED. They are never logged, never
  returned, never placed in audit metadata, and never committed.
- The `SecretStore` port stays opaque: consumers pass a key and get a value; the
  port never learns Fiscal semantics, and Fiscal never imports a concrete
  driver.
- No domain outside the owning one may read another tenant's secret; every read
  filters on the resolved tenant context, never on a request-supplied value.
- Adding a second stored secret per signing material requires a superseding ADR
  or Decision, because D6 is a boundary property.
- The in-memory driver is test-only; the production gate is duplicated at the
  schema and at the module factory, exactly as `resolveFiscalProvider` does it.
- Any future consumer of `SecretStore` from a non-Fiscal domain is a new
  architectural decision, not a free extension: this ADR authorizes the
  boundary, not unbounded consumption.
- No PRD change. PRD §41's classification requirement is satisfied, not
  modified.

## References

- [[DEC-053]] — Tenant fiscal signing material and the `SecretStore` boundary
  (accepted 2026-10-04; the product-level choices this ADR records)
- [[DEC-042]] — Fiscal boundary ownership
- [[DEC-048]] — Fiscal provider port and fake provider
- [[DEC-050]] — Fiscal storage sanitization and classification
- [[ADR-001]] — Modular Monolith (the Core/vertical boundary this capability
  respects)
- `docs/06-fiscal/SIFEN-BASELINE.md` — the F1 software-signing certificate
  standard and the mutual-TLS dual use, from the official DNIT source
- `docs/06-fiscal/SIFEN.md` — the provider sequence and the boundary rule
- `docs/03-architecture/REVERSALS-CORRECTIONS.md` — the explicit-operation rule
  D7 applies to retirement
- `packages/storage/src/storage.port.ts` — the port shape this capability
  mirrors
- `docs/99-governance/ENGINEERING-RULES.md` — "Secrets never live in Git or
  plaintext application records"
- `docs/99-governance/DOCUMENTATION-RULES.md` — "change Fiscal Provider
  boundary" as an ADR case
