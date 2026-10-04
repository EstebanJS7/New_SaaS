---
id: FISC-007
type: story
title: Tenant signing material in the SecretStore
epic: EPIC-16
status: in-progress
priority: high
depends_on:
  - FISC-006
prd_sections:
  - "22"
  - "23"
  - "41"
permissions:
  - fiscal.signing_material.manage
branch: feat/epic-16-fisc-007-signing-material
created: 2026-10-04
updated: 2026-10-04
---

# FISC-007 — Tenant signing material in the `SecretStore`

## Objective

Give a tenant a place to load, inspect and retire its SIFEN signing material —
the PSC-issued certificate and its private key — with the private key held as
**RESTRICTED** material, encrypted at rest, never logged, never returned and
never written to a Git file.

This is the first Story in [[EPIC-16]] that puts real secret material inside our
boundary, so it also builds the boundary that holds it: a reusable `SecretStore`
platform capability, authorized by [[ADR-005]] and [[DEC-053]].

## Context

[[EPIC-15]] built the Fiscal boundary around an opaque credential reference
([[DEC-042]], [[DEC-048]]) while a deterministic fake stood in for the provider.
Nothing in the repository can hold a private key today: there is no secret
store, no encrypted column and no fiscal credential mechanism of any kind.

The retarget to SIFEN Direct removed the option that made this cheap. The
baseline in `docs/06-fiscal/SIFEN-BASELINE.md` pins the material's shape from
the official DNIT source: an X.509 v3 certificate from a PSC habilitado por el
MIC, type **F1 = firma digital por software**, used **both** to sign data
messages **and** to authenticate mutual TLS. The same certificate, two uses.

`docs/99-governance/ENGINEERING-RULES.md` already forbids secrets in Git or in
plaintext application records; [[ADR-005]] records the boundary this Story
implements.

## Decisions taken for this Story

**D1 — Envelope encryption in PostgreSQL** ([[DEC-053]]/D1, [[ADR-005]]/D2). A
platform master key from environment wraps a per-secret data key; the data key
encrypts the material with AES-256-GCM. Verified design, no new deployable.

**D2 — The operator uploads a PKCS#12 plus its password** ([[DEC-053]]/D2).

**D3 — The material enters through audited staff API routes** ([[DEC-053]]/D3),
behind one new permission, with an audit row per operation.

**D4 — The password never persists** ([[DEC-053]]/D4, [[ADR-005]]/D6). The
upload decrypts the container in memory, extracts the certificate and the
private key, and forgets the password. Exactly **one** secret is stored per
signing material.

**D5 — Retirement destroys the stored private key and keeps the record**
([[ADR-005]]/D7). A material moves `ACTIVE → RETIRED` with an actor, a timestamp
and a reason; the row survives as the permanent record, and the ciphertext in
`tenant_secret` is **deleted in the same transaction**. Removing a material from
service therefore removes the key rather than parking it indefinitely, at the
cost that a rollback means re-uploading the operator's PKCS#12 — which the
operator always still holds. This is recorded as a consequence, not a silent
choice: an audit trail and a destroyed key are in tension and the resolution is
deliberate.

**D6 — Rotation is an upload, not a separate command.** Loading a new material
retires the current one for the same `(tenant, environment)` in the same
transaction, applying both D5's record rule and D5's key-destruction rule.

**D7 — The `SecretStore` package has no Nest module.** `packages/storage`'s
`StorageModule.forRoot()` reads only its own environment, so it can choose a
driver inside the package. This capability cannot: its persistent driver needs a
Prisma-backed record repository that lives in the application. The package
therefore exports the port, the drivers, the envelope crypto, the key-ring
resolver and the opaque-key factory, and **the application is the composition
root** — which is literally what [[DEC-053]]/D1 asks for ("port + drivers in a
package, selection in the app").

**D8 — The parser dependency is chosen here and verified, not remembered.** See
the next section. It is not ADR-006: [[ADR-005]]'s sibling ADR candidate covers
the **XAdES signing** dependency for [[FISC-009]], which is a different
requirement (XML canonicalization and signature construction).

**D9 — No new `ErrorCode`.** `packages/shared/src/errors/registry.ts` is frozen
and append-only; this Story reuses `VALIDATION_FAILED`, `NOT_FOUND` and
`CONFLICT` with Story-specific message constants, exactly as [[FISC-005]] does.

## The parser dependency: verified, not assumed

**Node cannot open a PKCS#12.** Measured on Node v24.14.0 against a container
generated with OpenSSL, with no dependencies installed:

```text
crypto.createPrivateKey({ key: p12, format: "der", type: "pkcs12", passphrase })
  -> The property 'options.type' is invalid. Received 'pkcs12'
crypto.createPrivateKey({ key: p12, format: "der", passphrase })      -> invalid type
crypto.createPrivateKey({ key: p12 })                                 -> DECODER routines::unsupported
crypto.createPrivateKey({ key: p12, format: "der", type: "pkcs8" })   -> asn1: wrong tag
crypto.createPrivateKey({ key: p12, format: "der", type: "pkcs1" })   -> DECODER routines::unsupported
```

`crypto.X509Certificate` **can** parse a certificate from PEM or DER, so the
certificate side needs no dependency; only the container does.

**Chosen by the maintainer: `pkijs` + `asn1js`.** Verified from the npm registry
on 2026-10-04 (publisher, version, license, engine):

| Package  | Version | License      | Engine     | Provenance                                      |
| -------- | ------- | ------------ | ---------- | ----------------------------------------------- |
| `pkijs`  | 3.4.1   | BSD-3-Clause | `>=16.0.0` | npm attestations with SLSA provenance published |
| `asn1js` | 3.0.10  | BSD-3-Clause | —          | —                                               |

Transitive runtime dependencies resolved with `pnpm`-equivalent resolution:
`@noble/hashes@1.8.0`, `bytestreamjs@2.0.1`, `pvtsutils@1.3.6`, `pvutils@1.2.0`,
`tslib@2.8.1`. `npm audit` reports **0 vulnerabilities**. `node-forge` was the
alternative and was rejected: its 1.4.0 line already carries a November 2025
ASN.1 validator advisory (`GHSA-5gfm-wpxw-jjgq`, patched in 1.3.2), and it adds
a library the FISC-009 signing path does not use. `@peculiar/x509` is **not**
needed: `node:crypto`'s `X509Certificate` covers certificate parsing.

**The recipe, verified end to end** against an OpenSSL-generated container
(private key recovered as RSA 2048, certificate pair proven, wrong password
rejected):

```ts
const pfx = PFX.fromBER(buffer); // pkijs
await pfx.parseInternalValues({ password }); // integrity check: a wrong password throws
const authenticatedSafe = pfx.parsedValue.authenticatedSafe;
await authenticatedSafe.parseInternalValues({
  safeContents: authenticatedSafe.safeContents.map(() => ({ password })),
});
const bags = authenticatedSafe.parsedValue.safeContents.flatMap(
  (c) => c.value.safeBags ?? []
);
// key  bag id 1.2.840.113549.1.12.10.1.2  -> PKCS8ShroudedKeyBag
// cert bag id 1.2.840.113549.1.12.10.1.3  -> CertBag, certId 1.2.840.113549.1.9.22.1
await keyBag.bagValue.parseInternalValues({ password }); // -> parsedValue: PrivateKeyInfo
const pkcs8Der = keyBag.bagValue.parsedValue.toSchema().toBER(false);
const keyObject = crypto.createPrivateKey({
  key: Buffer.from(pkcs8Der),
  format: "der",
  type: "pkcs8",
});
const certDer = certBag.bagValue.certValue.valueBlock.valueHexView;
const x509 = new crypto.X509Certificate(Buffer.from(certDer));
x509.checkPrivateKey(keyObject); // proves the pair matches, natively
```

**Two recorded warts.** `PKCS8ShroudedKeyBag.parseInternalValues` is declared
`protected` in pkijs's typings, so the adapter must call it through a narrow,
locally declared structural type rather than casting the whole object to `any`.
And `pfx.parseInternalValues` performs the PKCS#12 MAC integrity check by
default, which is what makes a wrong password fail there rather than later; the
adapter must not disable it.

## The test fixture: built, not committed

Two harness constraints shape this Story, and both were surfaced to the
maintainer before any code was written.

**The package is `packages/secret-store`, not `packages/secrets`.** The
harness's path guard blocks any path segment literally named `secrets` and any
`.pem`, `.key`, `.p12` or `.pfx` file, for `read`, `write` and `edit`. The
maintainer chose the rename over disabling the guard, and `secret-store` is also
[[ADR-005]]'s own vocabulary. Nothing about the boundary, the port or the
behaviour changes with the name.

**The PKCS#12 fixture is constructed in the test, not committed.** The same
guard blocks a committed `.p12`, and a real container in the repository would be
a credential-shaped artifact. The test builds its container in memory with
pkijs's own PFX builder and feeds it to the parser, so the parser is still
proven end to end against a real PKCS#12 structure with a real password. The
cost is recorded honestly: a self-constructed container is **not** a PSC
artifact, so [[FISC-013]] must validate the extraction against a real PSC-issued
container during homologation, and that is an acceptance item there, not an
assumption here.

## In Scope

- `packages/secret-store` (`@newsaas/secret-store`): the `SecretStore` port, envelope
  crypto, the versioned key-ring resolver, the envelope driver, the in-memory
  driver, the opaque key factory, and their unit tests.
- Two additive tables plus one partial unique index, in one migration.
- `pkijs` + `asn1js` as dependencies, and the PKCS#12 → (private key,
  certificate) extraction with its tests.
- The application composition root: `SECRET_RECORDS` (Prisma-backed), the
  `SECRET_STORE` selection, and the production refusal.
- The Fiscal signing-material aggregate: repository, service commands, audit,
  one new permission and its role grants.
- Three staff routes and their contract pins.
- Tenant isolation and backend authorization coverage for every new read and
  write.
- The `Fiscal.md` module documentation update.

## Out of Scope

- **XML generation, XSD validation, signing and DNIT web services.** Those are
  [[FISC-008]], [[FISC-009]], [[FISC-010]].
- **Timbrado and numbering.** [[FISC-011]].
- **`SIFEN_DIRECT` as a `FISCAL_PROVIDER` value.** [[FISC-012]]. This Story does
  not touch `resolveFiscalProvider`'s closed set.
- **A web UI for the new routes.** The maintainer's decision was "audited staff
  API routes"; the surface is HTTP, and a `/app/fiscal` panel is follow-up work.
- **A KEK rewrap command.** The versioned key ring makes a KEK rotation a
  configuration change; re-encrypting old rows under the newest version is
  deliberately not shipped (see Known Limitations).
- **XAdES, KuDE, the portal fiscal surface, reports, notifications.**

## Acceptance Criteria

- [ ] `packages/secret-store` exports a `SecretStore` port whose reads are
      tenant-scoped, and two drivers: an in-memory driver for tests and an
      envelope driver that encrypts with AES-256-GCM.
- [ ] A key-ring resolver reads a versioned master-key list from environment and
      a row encrypted under an older version still decrypts after a newer
      version becomes current. Covered by a unit test.
- [ ] The production gate refuses to boot without a master key, and the module
      selection refuses to fall back to the in-memory driver in production — the
      duplicated-refusal shape `resolveFiscalProvider` already uses. Covered by
      a unit test.
- [ ] A stored secret is never recoverable from the database without the master
      key: an integration test asserts the persisted bytes do not contain the
      plaintext.
- [ ] `POST /fiscal/signing-material` accepts a PKCS#12 plus its password,
      validates that the container's integrity check passes, that exactly one
      X.509 certificate bag is present, that the private key is RSA with a
      modulus of at least 2048 bits, that the key and the certificate match, and
      that the certificate has not expired. Each rejection has its own test.
- [ ] The password is never persisted: an integration test asserts no row and no
      log line contains it.
- [ ] The private key is never returned: an integration test asserts no response
      body of the three routes contains a private key marker.
- [ ] The stored material is classified RESTRICTED in the schema comment and in
      the module documentation, and no log or audit payload carries it.
- [ ] `GET /fiscal/signing-material` returns metadata only, never the private
      key, never the password and never the `credentialRef`.
- [ ] `POST /fiscal/signing-material/:id/retire` requires a reason, transitions
      `ACTIVE → RETIRED`, **deletes the stored key in the same transaction**,
      and writes an audit row. Repeating it on a retired material is a `409`.
- [ ] A second upload for the same `(tenant, environment)` retires the previous
      material in the same transaction. Only one `ACTIVE` row per pair can
      exist, proven by the partial unique index under the live-PostgreSQL gate.
- [ ] Every route requires authentication, tenant membership and the
      `fiscal.signing_material.manage` permission.
- [ ] A cross-tenant read or retire returns `404`, never `403` and never data.
      Covered by tenant-isolation tests.
- [ ] The two pins in `apps/api/src/rbac/route-contract.probe.test.ts`
      (`EXPECTED_ROUTE_INVENTORY` and `FISCAL_PERMISSION_BY_ROUTE`) carry the
      three new routes.
- [ ] The seed is idempotent at `permissions: 58` and `rolePermissions: 195`,
      granting the new key to `OWNER` and `ADMIN` only.
- [ ] `docs/05-modules/Fiscal.md` documents the boundary, the classification and
      the three routes.
- [ ] Lint, typecheck, unit tests, the live-PostgreSQL gate and the build pass.

## Domain Invariants

- **One stored secret per signing material.** The private key. The password has
  no lifetime in the system.
- **A retired material is never used to sign.** FISC-009 resolves the active
  material; this Story makes "active" unambiguous and unique per environment.
- **The material is immutable once loaded.** Certificates are not edited;
  rotation is a new material.
- **The certificate is public; the private key is RESTRICTED.** The row may
  carry the certificate and derive metadata from it; it must never carry key
  material.
- **A cross-tenant access is indistinguishable from a missing row.**
- **The `SecretStore` never learns Fiscal semantics**, and Fiscal never imports
  a concrete driver.

## API

### Added

```text
POST /fiscal/signing-material
  multipart/form-data
    file        : the PKCS#12 (.p12/.pfx), <= 65536 bytes
    password    : string, 1..1024
    environment : TEST | PRODUCTION
  -> 201 { id, environment, status, certificateSubject, certificateSerial,
           certificateFingerprintSha256, keyAlgorithm, notBefore, notAfter,
           createdAt, retiredAt }
  errors: 400 VALIDATION_FAILED (malformed container, wrong password,
          unsupported key, expired certificate, oversized or missing part)
          (permission required: fiscal.signing_material.manage)

GET /fiscal/signing-material
  -> 200 { items: [...same shape...] } for the resolved tenant, newest first
  (permission required: fiscal.signing_material.manage)

POST /fiscal/signing-material/:id/retire
  body { reason: string, 1..500 }
  -> 200 { id, status: "RETIRED", retiredAt }
  errors: 404 NOT_FOUND (unknown, other tenant, or already erased material)
          409 CONFLICT (already retired)
  (permission required: fiscal.signing_material.manage)
```

No route ever returns the private key, the password, the certificate PEM or the
`credentialRef`.

### Changed

```text
apps/api/src/fiscal/fiscal.permissions.ts
  + signingMaterialManage: "fiscal.signing_material.manage"
```

## Database

### Migration

```text
packages/database/prisma/migrations/20261004000002_fiscal_signing_material
```

Additive only. Creates the two enums, the two tables and the partial unique
index. No existing table is altered, so there is no backfill.

### Models/Tables

```text
tenant_secret                       -- RESTRICTED: ciphertext only
  id            uuid pk
  tenant_id     uuid  FK -> tenant (RESTRICT, onUpdate RESTRICT)
  key           text          -- opaque key from createOpaqueSecretKey
  algorithm     text          -- "AES-256-GCM"
  key_version   int           -- master-key version that wrapped the data key
  wrapped_key   bytea         -- data key, wrapped by the master key
  wrap_iv       bytea
  wrap_auth_tag bytea
  ciphertext    bytea
  iv            bytea
  auth_tag      bytea
  created_at    timestamptz(3)
  updated_at    timestamptz(3)
  UNIQUE (tenant_id, key)
  UNIQUE (tenant_id, id)

tenant_fiscal_signing_material      -- INTERNAL: certificate + metadata
  id                            uuid pk
  tenant_id                     uuid FK -> tenant (RESTRICT)
  environment                   fiscal_signing_environment  TEST | PRODUCTION
  status                        fiscal_signing_material_status  ACTIVE | RETIRED
  credential_ref                text   -- opaque key into tenant_secret
  certificate_pem               text
  certificate_subject           text
  certificate_serial            text
  certificate_fingerprint_sha256 text
  key_algorithm                 text   -- e.g. "RSA_2048"
  not_before                    timestamptz(3)
  not_after                     timestamptz(3)
  uploaded_by_user_profile_id   uuid NULL   -- provenance; the audit row is authoritative
  retired_at                    timestamptz(3) NULL
  retired_by_user_profile_id    uuid NULL
  retirement_reason             text NULL
  created_at                    timestamptz(3)
  updated_at                    timestamptz(3)
  UNIQUE (tenant_id, id)
  INDEX  (tenant_id, status)
  UNIQUE (tenant_id, environment) WHERE status = 'ACTIVE'   -- raw SQL, not expressible in Prisma
```

## UI

- None. This Story ships HTTP routes only; the staff panel stays follow-up work.

## Audit

```text
fiscal.signing_material.uploaded
  metadata { schemaVersion, environment, certificateSerial, certificateFingerprintSha256 }

fiscal.signing_material.retired
  metadata { schemaVersion, environment, certificateSerial, reason }
```

Never the PEM, never the password, never the `credentialRef`, never the
ciphertext.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```

## Tests Added

Planned:

- `packages/secret-store` unit: envelope round-trip; wrong master key fails closed; a
  row under version 1 decrypts while version 2 is current; the key-ring parser
  rejects a malformed or missing current version; the in-memory driver is
  tenant-scoped; `createOpaqueSecretKey` is opaque.
- `packages/secret-store` unit: the persistent driver is never selected in production
  and the refusal is the same shape `resolveFiscalProvider` uses.
- `packages/fiscal` unit: PKCS#12 extraction against a container **constructed in
  the test with pkijs** (see the fixture note above); wrong password; no
  certificate bag; two certificate bags; a non-x509 `certId`; a non-RSA key; a
  1024-bit key; a key that does not match the certificate; an expired
  certificate.
- API unit/integration: the three commands, the metadata-only shape, the
  password-never-persisted assertion, the private-key-never-returned assertion,
  the retire CAS and the `409` on a repeat, rotation retiring the previous
  material in one transaction, the secret deleted on retire, and one audit row
  per operation.
- API tenant isolation: a second tenant gets `404` on read and retire, and no
  row of the first tenant is reachable.
- API authorization: each route without the permission is `403`.
- Live PostgreSQL: the partial unique index rejects a second `ACTIVE` row; the
  ciphertext is not the plaintext; the FK and tenant scoping hold.
- `route-contract.probe.test.ts`: two pins updated.

## Known Limitations

- **We own the master key.** Losing `SECRET_STORE_MASTER_KEYS` makes every
  stored private key unrecoverable. Backup and custody of that value are an
  operational requirement the code cannot satisfy, recorded in [[ADR-005]]'s
  consequences.
- **No KEK rewrap command.** A rotation adds a version and old rows keep
  decrypting with the version recorded in the row; re-encrypting old rows under
  the newest version is not shipped.
- **The in-memory driver is the development default**, so a development
  environment stores secrets in process memory only and loses them on restart.
  The production refusal is what keeps that from being a deployment risk.
- **`PKCS8ShroudedKeyBag.parseInternalValues` is `protected` in pkijs's
  typings**, so the adapter reaches it through a narrow locally declared
  structural type. This is a typing wart, not a behavioural one.
- **A rollback after retirement re-uploads the operator's file.** D5 destroys
  the key on retirement, so there is no "reactivate the previous material" path.
- **The certificate PEM is stored inline**, not in object storage, because it is
  needed on every signing call and is small. The XML and KuDE artifacts, which
  are large and per-document, stay in `@newsaas/storage`.

## Technical Debt

- The `/app/fiscal` panel for the three routes is follow-up work, tracked when
  the surface is designed.
- A KEK rewrap command, if Key custody ever needs scheduled rotation.

## Decisions / ADRs

- [[ADR-005]] — Tenant signing material behind a `SecretStore` boundary.
- [[DEC-053]] — Tenant fiscal signing material and the `SecretStore` boundary.
- **[[ADR-006]] is not this Story.** It covers the XAdES signing dependency for
  [[FISC-009]].

## Files / Modules

```text
packages/secret-store/package.json
packages/secret-store/src/secret-store.port.ts
packages/secret-store/src/secret-envelope.ts
packages/secret-store/src/secret-key-ring.ts
packages/secret-store/src/envelope-secret-store.ts
packages/secret-store/src/in-memory-secret-store.ts
packages/secret-store/src/secret-keys.ts
packages/secret-store/src/index.ts
packages/secret-store/tsconfig.json / vitest config per the existing package shape

packages/fiscal/src/signing-material/pkcs12.ts
packages/fiscal/src/signing-material/signing-material.types.ts

apps/api/src/secret-store/secrets.module.ts
apps/api/src/secret-store/secrets.module.test.ts
apps/api/src/fiscal/signing-material/*.ts
apps/api/src/config/api-env.schema.ts
apps/api/src/fiscal/fiscal.permissions.ts
apps/api/src/rbac/route-contract.probe.test.ts

packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20261004000002_fiscal_signing_material/
packages/database/src/reference-seed.ts

docs/05-modules/Fiscal.md
```

## Completion Notes

_Status must remain non-`done` until every acceptance criterion and gate
passes._
