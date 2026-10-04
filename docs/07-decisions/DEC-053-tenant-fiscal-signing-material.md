---
id: DEC-053
type: decision
title: Tenant fiscal signing material and the SecretStore boundary
status: accepted
date: 2026-10-04
related_epics:
  - EPIC-16
related_stories:
  - FISC-007
prd_change_required: false
---

# DEC-053 — Tenant fiscal signing material and the SecretStore boundary

## Context

[[EPIC-16]] was retargeted from a third-party fiscal adapter to **SIFEN Direct**
on 2026-10-03. That retarget has one consequence the third-party plan did not
have: with no vendor in the middle, the tenant's **signing private key** enters
our boundary. [[DEC-042]] and [[DEC-048]] built the Fiscal boundary around an
opaque credential reference, so nothing in the repository can hold that key
today: there is no `SecretStore`, no encrypted column, and no fiscal credential
mechanism of any kind.

[[ADR-005]] is required before [[FISC-007]] because
`docs/99-governance/DOCUMENTATION-RULES.md` names **"change Fiscal Provider
boundary"** as an explicit ADR case, and because
`docs/99-governance/ENGINEERING-RULES.md` states that secrets never live in Git
or in plaintext application records.

The epic's `D1` already fixed the shape — a `SecretStore` port with drivers in a
package, selection in the application, mirroring the `StoragePort` precedent of
`@newsaas/storage`. This Decision fixes the three axes that `D1` left open, and
one consequence that follows from them.

## Question

1. How is the tenant's signing material protected **at rest**?
2. What artifact does an operator hand us when the certificate is loaded?
3. Where does that material enter the system?

## Options

### Axis 1 — protection at rest

**Option A — envelope encryption in PostgreSQL.** A platform master key (KEK)
supplied by environment wraps a per-secret data key; the data key encrypts the
material with AES-256-GCM; the ciphertext lives in our own table. No new
deployable, no new operational dependency, and the material never leaves the
database we already run. Cost: **we own key custody**. A lost `KEK` makes every
stored key unreadable, and losing the keys is losing the ability to sign.

**Option B — external secret manager.** A production driver against AWS Secrets
Manager or HashiCorp Vault; in-memory only for tests. No ciphertext in our
database and custody moves to the provider. Cost: a new operational dependency
for every deployment, including self-hosted ones, and a production configuration
that cannot boot without it.

**Option C — the port plus both drivers.** The contract accepts either; the
selection is an environment variable. Cost: two production code paths to keep
working, test and document, with no story that needs the second one.

### Axis 2 — the operator's artifact

**Option A — PKCS#12 plus its password.** One `.p12`/`.pfx` file exactly as the
PSC delivers it, plus the password that protects it. This is the artifact an
operator actually has.

**Option B — separate PEM files.** Private key and certificate as separate PEM
inputs plus a password. More explicit for us, more pieces for the operator to
mix up.

### Axis 3 — the entry point

**Option A — audited API routes.** Upload, list and retire over the existing
staff surface, behind a new permission, with an audit row per operation. The
material never comes back out of any response.

**Option B — operator-only, no HTTP.** The material enters through an
out-of-band operator command; the API only ever reads metadata.

## Recommendation

Axis 1 **Option A**: the system already runs PostgreSQL and already treats the
application as the trust boundary (`StoragePort`, the fail-closed snapshot
sanitizer, the sanitized audit payloads). Adding an external custody dependency
for an epic that adds no deployable contradicts the epic's own scope. Custody is
a real cost, and it is recorded as such rather than hidden.

Axis 2 **Option A**: the operator's real artifact is the one to accept. Asking
an operator to split a PKCS#12 into PEM files by hand is a support burden and a
new way to corrupt a key.

Axis 3 **Option A**: the alternative is an unauthenticated side channel that
bypasses RBAC, audit and tenant isolation. The repository's rule is that every
protected operation validates authentication, membership, permission and
resource ownership; an operator command outside HTTP satisfies none of them
while still being callable by whoever holds the shell.

## Decision

**Accepted 2026-10-04.** The maintainer chose, per axis: **A, A, A**.

- **DEC-053/D1 — Envelope encryption in PostgreSQL.** A platform master key
  (`SECRET_STORE_MASTER_KEY`, base64 of 32 bytes) is supplied by environment. A
  per-secret random data key encrypts the material with AES-256-GCM; the data
  key itself is wrapped by the master key. The record stores the wrapped data
  key, the IV, the authentication tag, the algorithm and the master-key version.
  Ciphertext at rest lives in a new `tenant_secret` table. The production gate
  refuses to boot without the master key, so the in-memory driver can never be
  selected silently in production.
- **DEC-053/D2 — The operator uploads PKCS#12 plus its password.**
- **DEC-053/D3 — The material enters through audited staff API routes** behind a
  new permission. No response ever carries the private key or the password.

**DEC-053/D4 — A consequence of D2, decided here so it is not discovered later:
the password is never persisted.** The upload decrypts the PKCS#12 in memory,
validates the password, extracts the certificate and the private key, and then
forgets the password. Only the **private key** is RESTRICTED material held at
rest; the certificate is public material (it is transmitted in every signed
document). This is strictly less secret material than storing the container and
its password, and it removes the password from every later signing call.

## Impact

### Product

- A tenant can load, list and retire its signing material. "Rotate" is uploading
  a new material, which retires the current one in the same transaction.
- The certificate's holder, RUC, serial and validity window become visible
  metadata, so expiry is observable before it breaks emission.

### Architecture

- A new reusable platform capability: `packages/secrets`, with a `SecretStore`
  port, an envelope driver, an in-memory driver and a module — the same shape as
  `@newsaas/storage`. Fiscal consumes the port; it never reaches a concrete
  driver.
- The Fiscal boundary becomes responsible for RESTRICTED material. That is the
  architectural change [[ADR-005]] records.
- **Custody.** We now own a key whose loss is unrecoverable. This is the epic's
  single largest operational risk and is recorded as such in [[ADR-005]] and in
  the Story's known limitations.

### Database/API

- Two new tables: `tenant_secret` (ciphertext, wrapped data key, IV, tag,
  algorithm, key version) and `tenant_fiscal_signing_material` (certificate
  metadata plus an opaque `credentialRef` into the former).
- One new partial unique index: at most one `ACTIVE` material per tenant and
  environment.
- New routes: upload, list and retire. One new permission. One new environment
  variable, refused in production when absent.

### Delivery

- [[FISC-007]] depends on this Decision and on [[ADR-005]]. [[FISC-009]] (XAdES
  signing) is the first consumer of the private key and therefore of the
  `SecretStore`.

## PRD Update

**Not required.** PRD §22/§23 already describe `SIFEN_DIRECT` and the
revalidation precondition; PRD §41 already requires that sensitive material be
classified and never logged. This Decision chooses an implementation shape
inside approved scope. `docs/00-product/PRD.md` is untouched.
