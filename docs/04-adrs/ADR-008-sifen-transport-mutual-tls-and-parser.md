---
id: ADR-008
type: adr
title:
  The SIFEN transport — SOAP over mutual TLS, a per-call credential read, and
  two new dependencies
status: accepted
date: 2026-10-08
supersedes: []
superseded_by:
related_epics:
  - EPIC-16
related_decisions:
  - DEC-042
  - DEC-048
  - DEC-053
related_stories:
  - FISC-010
  - FISC-012
approval_record:
  decision_proposal: none
  decision_status: accepted
  decision_approval_date: 2026-10-08
  adr_gate_authority:
    the epic's ADR candidate 4 plus docs/99-governance/DOCUMENTATION-RULES.md
    "change Fiscal Provider boundary" and AGENTS.md's dependency rule
  adr_acceptance_basis:
    authored in FISC-010's WU-A at the maintainer's instruction of 2026-10-08,
    which also fixed the boundary between FISC-010 (the port and the transport,
    proven with a double) and FISC-012 (the worker wiring and the signing stage)
---

# ADR-008 — The SIFEN transport

## Decision Summary

SIFEN's web services are SOAP 1.2 Document/Literal over TLS 1.2 with **mutual
authentication using the taxpayer's certificate** (baseline §7, from the
Manual's §7.9). The adapter that speaks them runs inside the **worker**, and the
worker has no credential boundary today: `SECRET_STORE_MASTER_KEYS` and the
`SecretsModule` live in `apps/api/src`, no code path anywhere reads a tenant's
private key back out of the store, and the provider the worker injects is a
**process singleton** built by a static factory that reads `process.env`.

Four decisions:

1. **The transport is `node:https` with a per-call mutual-TLS agent built from
   the tenant's certificate — no HTTP client dependency.** `agent: false` on
   every call, so **no socket is ever pooled and no connection can be reused
   across tenants**; `minVersion: "TLSv1.2"`, server verification on, redirects
   refused rather than followed.
2. **The credential boundary is a port, read per call, never held by the
   provider.** `FiscalCredentialPort.read({ tenantId, environment })` returns
   the tenant's certificate and private key or `null`; the provider is a process
   singleton that holds the _port_ and reads the _material_ per call. FISC-010
   defines it and proves it with a double; **[[FISC-012]] implements it in the
   worker**, because the implementation needs `@newsaas/secret-store` and
   Prisma, and `packages/fiscal` must not depend on either.
3. **Two new runtime dependencies in `packages/fiscal`**: `fast-xml-parser`
   (`^5.11.2`) to parse responses, and `fflate` (`^0.8.3`) for the ZIP container
   the batch service requires in both directions. Both MIT, neither native,
   neither pulling a DOM lib. `@xmldom/xmldom` is refused for the reason
   [[ADR-006]] already recorded, and `libxmljs2` stays the dev-only XSD gate.
4. **The environment is a deployment-level value, and the signing material's
   `environment` column becomes a guard, not a selector.** The MVP talks to one
   DNIT environment per deployment (`SIFEN_ENVIRONMENT`), and a tenant whose
   active material is for the _other_ environment fails closed with
   `CONFIGURATION_ERROR` — never by silently presenting the other certificate.
   Per-tenant environment selection is a later product decision, recorded here
   as a limitation rather than assumed.

**What it deliberately does not do**: it does not implement
`SifenDirectFiscalProvider`, does not wire the worker, and does not read a
secret. It decides the shape of the boundary those will use.

## Context

### The protocol facts, and where they come from

Baseline §7 and §8, from the Manual's §7.4, §7.9 and §7.10:

```text
Web Services      WS-I Basic Profile 1.1
Protocolo         SOAP 1.2
Estilo/Encoding   Document/Literal
Transporte        Internet + TLS 1.2 con AUTENTICACIÓN MUTUA (certificados)
Certificado       ITU-T X.509 V.3, emitido por un PSC habilitado por el MIC
```

and §23 adds what the service schemas themselves say. Three of those findings
shape this ADR directly:

- **`xDE` means two different things in two services.** In the synchronous
  reception schema it is a **wildcard that carries the DE as a child element**
  (`<xs:any namespace="http://ekuatia.set.gov.py/sifen/xsd" processContents="skip"/>`);
  in the batch schema it is **`xs:base64Binary` with
  `xmime:expectedContentTypes="application/zip"`**. Same element name, two
  encodings, and the Guide's own example shows the base64 form for the batch.
- **The response bodies are namespace-prefixed by the producer**
  (`<ns2:rResEnviLoteDe xmlns:ns2="…">` in the Guide's examples), and the
  Manual's own envelope example is defective in a way that matters here: it uses
  a lowercase `<soap:body>` and mismatched `env`/`soap` prefixes (baseline §8).
  **A reader keyed on prefixes would inherit the defect.**
- **The WSDL is unread.** `https://sifen-test.set.gov.py/…` and
  `https://sifen.set.gov.py/…` both answer `HTTP/1.0 302 Found` with
  `Location: /vdesk/hangup.php3` and `Content-Length: 0`, for every service path
  — and so does a **bogus path** and the host **root**, so the probe says
  nothing about the paths themselves (baseline §23 records the control probe).
  **SOAPAction, bindings and header requirements are therefore open**, and this
  ADR does not invent them.

### The application facts

Verified on `68b3c74`:

- **The provider is a process singleton with no per-call context.**
  `FiscalProviderModule` is a static module whose single factory returns
  `createFakeFiscalProvider()`; it reads `process.env` directly and takes no
  tenant, no credential and no port. `FiscalIssueRequest` carries `tenantId` and
  nothing secret.
- **The worker has no credential boundary.** `apps/worker/package.json` does not
  depend on `@newsaas/secret-store`; `WorkerModule` imports no secrets module;
  `worker-env.schema.ts` declares no `SECRET_STORE_*` entry. The API's
  `SecretsModule.forRoot()` is `@Global()` but global only within its own Nest
  application.
- **Nothing reads a tenant's private key back.** The signing-material service
  `put`s and `delete`s `extracted.privateKeyPem`; there is no `secretStore.get`
  call in `apps/api/src/fiscal`, and the only projection is metadata-only
  (`FiscalSigningMaterialView`). The row holds `credentialRef` and
  `certificatePem`; the key lives in `tenant_secret` behind the ref.
- **A tenant may hold one `ACTIVE` material per environment.** The partial
  unique index is `("tenant_id", "environment") WHERE "status" = 'ACTIVE'`, and
  the repository exposes both `findActive(environment)` and "every `ACTIVE`
  material the tenant holds, across environments". **So the credential read must
  be told which environment it is reading for** — the material cannot answer
  that by itself.
- **There is no outbound transport of any kind.** No `node:https`, `undici`,
  `axios` or `got` in backend production code, and no TLS configuration
  anywhere. `packages/fiscal`'s only XML is a string builder plus `xml-crypto`.
- **`apps/worker` and `apps/api` share no code** beyond workspace packages: no
  path mapping, no cross-app import. Whatever the worker needs must arrive as a
  workspace package or as worker-local code.

## Why an ADR is Required

Three separate rules converge:

- `DOCUMENTATION-RULES.md` names "change Fiscal Provider boundary" as an ADR
  case, and the credential read changes what the boundary owns: a provider that
  used to be stateless now resolves tenant secret material per call.
- `AGENTS.md` requires a concrete requirement before a new dependency, and this
  ADR adds two. The requirement is concrete: SIFEN's responses must be parsed,
  and its batch service transports a ZIP.
- `AGENTS.md`'s complexity budget freezes the deployables and the stack. A SOAP
  client, a TLS agent and a ZIP codec are the kind of "small library" that can
  quietly become a second transport stack; this ADR decides which ones and
  refuses the rest.

The epic states the gate directly: ADR candidate 4 is **the gate for
[[FISC-010]]**, and it must name "the boundary gains a per-call credential read
on a process-singleton provider, plus an XML parser `packages/fiscal` does not
have today".

## Decision

### 1. The transport

**SOAP 1.2 Document/Literal, posted by `node:https`, with a per-call mutual-TLS
configuration.**

```text
protocol      HTTPS POST, Content-Type: application/soap+xml; charset=utf-8
envelope      xmlns="http://www.w3.org/2003/05/soap-envelope"   (SOAP 1.2)
body elements qualified with xmlns="http://ekuatia.set.gov.py/sifen/xsd"
TLS           minVersion TLSv1.2, rejectUnauthorized true,
              cert + key from the tenant's credential, agent: false
timeout       default 60_000 ms  (baseline §11: SIFEN's maximum response
                                  time per DTE is 1 minute)
redirects     refused, never followed: a 3xx is an error carrying the status
              and the Location
response cap  8 MiB, then the call fails rather than buffering unbounded
```

**`agent: false` is the load-bearing detail.** Node's default agent pools and
reuses sockets; a pooled socket authenticated as tenant A could serve tenant B's
next call. With `agent: false` every call performs its own handshake and no
connection outlives it. The cost is a handshake per call, which is nothing next
to a document submission, and the property it buys is the one this boundary
cannot get wrong: **a tenant's authenticated connection is never reused by
another tenant**.

**No redirect following** is not a stylistic preference either: both hosts
answer `302 → /vdesk/hangup.php3` for everything unauthenticated, so a client
that follows redirects would fetch an HTML portal page and hand it to an XML
parser.

**The SOAPAction is not pinned, and is not invented.** SOAP 1.2 makes it a
media-type parameter rather than a mandatory header, the Guide's invocations
carry none, and the WSDL that would pin it is unread. It is recorded as an open
question in baseline §23 and in the Story: if a service rejects an envelope
without one, the action becomes a constant with a cited source.

**The request envelopes are built by an explicit serializer**, not by a builder
library: the shapes are small, fixed and known, and the only variable content is
a `dId` (an integer), a base64 blob and — in the synchronous service — **the
signed DE embedded verbatim**. Escaping is explicit, and the embedded document
is asserted to be the DE our own builder produced (`<rDE …>` as its first
element) rather than trusted to be well-formed.

### 2. The credential boundary

```ts
export type FiscalSigningEnvironment = "TEST" | "PRODUCTION";

/** What mutual TLS needs, and nothing else. */
export interface FiscalTransportCredential {
  /** PEM certificate. Public material: it is presented in the handshake. */
  readonly certificatePem: string;
  /** PKCS#8 PEM private key. RESTRICTED. */
  readonly privateKeyPem: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

export const FISCAL_CREDENTIAL_PORT = Symbol("FISCAL_CREDENTIAL_PORT");

export interface FiscalCredentialPort {
  /**
   * Reads the tenant's active material for one environment.
   * Returns `null` when the tenant has none — absence is a configuration
   * state, not an exception.
   */
  read(args: {
    readonly tenantId: string;
    readonly environment: FiscalSigningEnvironment;
  }): Promise<FiscalTransportCredential | null>;
}
```

- **Per call, never held.** The provider is a process singleton, so the
  credential is a _parameter of the operation_, not a field of the object. A
  singleton that cached a tenant's private key would hold RESTRICTED material
  across tenants and would need invalidation on rotation; a per-call read is one
  indexed row plus one decrypt.
- **`null` is a state, not an error.** The adapter maps it to
  `CONFIGURATION_ERROR`, which [[DEC-049]] already defines as terminal and
  non-retryable. A missing certificate must never become a transient retry loop.
- **One definition of the environment vocabulary.** `FiscalSigningEnvironment`
  is declared here, in `packages/fiscal`, and the app-local alias the
  signing-material service carries today is replaced by an import from the
  package — the type already exists in three places (Prisma's enum, the API's
  service and the DTOs) and a fourth copy in the port would be the one that
  drifts.
- **The material is validated before it is presented**: an expired certificate
  fails locally with `CONFIGURATION_ERROR` instead of producing a handshake
  failure whose reason the TLS stack reports as an opaque alert.
- **The port lives in `packages/fiscal`; the implementation lives in the
  worker** ([[FISC-012]]). `packages/fiscal` must not gain a Prisma or
  `@newsaas/secret-store` dependency, and the worker is where the provider runs.

**The module gains an injectable token with a fail-closed default.**
`FiscalProviderModule` becomes dynamic — `FiscalProviderModule.forRoot()` — and
declares `FISCAL_CREDENTIAL_PORT` with a default provider that returns `null`
for every read. A deployment that has not wired the real port therefore fails
closed with `CONFIGURATION_ERROR` instead of throwing at boot or, worse,
succeeding against a certificate it should not have. Both `apps/api` and
`apps/worker` change their import from `FiscalProviderModule` to
`FiscalProviderModule.forRoot()`.

### 3. The environment, and why the material's column is a guard

```text
SIFEN_ENVIRONMENT = test | production      (deployment-level, validated at boot)
```

The host follows from it, from baseline §8's table:

```text
test        https://sifen-test.set.gov.py
production  https://sifen.set.gov.py
```

A tenant may hold `ACTIVE` material for both environments (the index above says
so), so "the active material" is not a selector. The deployment selects the
environment; the tenant's material for **that** environment authenticates it; a
tenant with no material for it gets `CONFIGURATION_ERROR`. **The other
environment's certificate is never substituted**, which is the failure mode
worth designing against: presenting a test certificate to production is not a
degradation, it is a wrong-environment submission.

**Recorded limitation.** One deployment speaks to one DNIT environment, so a
single deployment cannot homologate one tenant while another issues in
production. That is acceptable for the MVP — homologation is [[FISC-013]] and
the certificate is per tenant — but it is a limitation, not a design. Per-tenant
environment selection belongs to a future Decision (it is product configuration,
not architecture), and it is recorded in the Story's Known Limitations.

### 4. The dependencies

**`fast-xml-parser`, pinned to `^5.11.2`, as a dependency of
`packages/fiscal`.**

```text
license        MIT
dependencies   6 packages, all MIT, all by the same publisher:
               strnum, is-unsafe, xml-naming, fast-xml-builder,
               @nodable/entities, path-expression-matcher
native code    none
DOM lib        none — it is a plain tree parser, not a DOM implementation
advisories     twelve historical OSV advisories (DOCTYPE entity expansion,
               regex injection in entity names, prototype pollution, ReDoS);
               every one of them is fixed at or below 5.10.1, and none applies
               to 5.11.2 as of 2026-10-08
```

**`fflate`, pinned to `^0.8.3`, as a dependency of `packages/fiscal`.**

```text
license        MIT
dependencies   none
native code    none
advisories     one historical advisory (GHSA-px8p-9vwx-vf98, an infinite loop
               in unzipSync on malformed ZIP64 archives); fixed in 0.8.3, which
               is the version this ADR pins
```

The ZIP is not optional and not our choice: the batch reception schema types
`xDE` as `xs:base64Binary` with `xmime:expectedContentTypes="application/zip"`,
the Guide's steps are "Comprimir el contenido de la estructura del lote rLoteDE"
then "Convertir el contenido comprimido a Base64", and the query services type
their result the same way. **We must write a ZIP to send a batch and read one to
consume a consultation.**

### 5. The parser's guardrails

A parser fed by an external service is an attack surface, and the advisory list
above is the evidence. Five rules, all testable:

1. **`<!DOCTYPE` is refused before parsing.** No response from SIFEN needs a
   document type declaration, and refusing the construct removes the entire
   entity-expansion class — the source of most of the advisories — without
   disabling entity handling, which numeric character references need (`&#233;`
   appears in the Guide's own response example).
2. **The response size is capped before the parser sees it** (8 MiB, above).
   Entity expansion and pathological documents are bounded by bytes, not by
   hope.
3. **No value coercion.** `parseTagValue: false` and
   `parseAttributeValue: false`: `dId`, `dCodRes`, `dProtConsLote`, the CDC and
   every money value stay **strings**. A parser that turns `1e5` into `100000`,
   or a 28-digit batch number into a float, is a money bug with a parser's name
   on it.
4. **`trimValues: false`.** The provider's bytes are kept as sent; comparison
   helpers normalise whitespace explicitly. SIFEN's own DE rules care about
   whitespace, so silently trimming would hide a difference this system may need
   to report.
5. **Every parsed value is validated against a known domain before it is used**,
   and the reader constructs its result field by field — never by spreading or
   merging parsed data into a domain object. `dEstRes` is one of three published
   strings, a result code is one of the codes §23 records, a CDC matches the CDC
   shape, a base64 payload matches base64. **Anything else is refused, never
   coerced**, which is what makes namespace-prefix games (`removeNSPrefix: true`
   strips them, and a prefix bound to a foreign namespace would collide) a
   bounded risk instead of an open one.

## Alternatives Considered

### `@xmldom/xmldom` as the parser

Refused, and the reason is already on record: its `index.d.ts` opens with
`/// <reference lib="dom" />`, which pulls the whole DOM lib into this Node-only
package's compilation and re-typed an unrelated WebCrypto union during
[[FISC-009]] ([[ADR-006]]). Declaring it would break a typecheck in a file this
Story does not touch.

### `libxmljs2` as the runtime parser

Refused. It is a native module with a build step, and it is deliberately the
**dev-only** XSD gate ([[FISC-008]]): it is reachable through
`packages/fiscal/src/testing.ts` and never through the runtime barrel. Putting a
native toolchain into the worker's dependency tree to parse three known response
shapes is a larger change than the problem.

### `sax` or `htmlparser2`

Considered and refused for a structural reason: both are **event** parsers, and
what this boundary needs is a tree with repeating groups (`gResProcLote`,
`gResProc`). Building that tree on top of an event parser is writing our own
parser again — the thing this ADR is refusing to do by hand.

### A hand-rolled ZIP writer over `node:zlib`

Tempting, because a single-entry ZIP is about a hundred lines and Node 22 has
`zlib.crc32`. Refused: the **write** side would be ours to get right, but the
**read** side parses a container produced by an external system — entry names,
multiple entries, stored-versus-deflated, data descriptors, ZIP64 sentinels.
`fflate` has zero dependencies and one historical advisory that its current
version fixes; a hand-rolled container reader has no advisory process at all.

### An HTTP client dependency (`undici`, `axios`, `got`)

Refused. `node:https` already does mutual TLS with per-request `cert`/`key`,
which is the only thing a SOAP POST needs beyond serialization. A client library
would add packages and, worse, an agent with a connection pool — the exact
mechanism this ADR avoids.

### Caching the tenant's credential in the provider

Refused. The provider is a process singleton, so a cache is RESTRICTED material
held across tenants, with rotation invalidation to get right and no measured
need: a submission is one row read and one decrypt.

### A new deployable for the fiscal adapter

Refused outright. `AGENTS.md` freezes the deployables (`web`, `api`, `worker`),
and the worker already runs the submission queue. The adapter is a library call
inside the process that exists.

## Consequences

### Positive

- **No new infrastructure**: no broker, no queue, no deployable, no HTTP client
  framework — two small libraries and Node's own TLS.
- **The credential boundary is explicit and per call**, so the process-singleton
  provider never holds tenant material, and rotation needs no cache
  invalidation.
- **The failure modes are closed rather than open**: no pooled sockets across
  tenants, no redirect following, no unbounded response, no DOCTYPE, no value
  coercion, no substitution of the other environment's certificate.
- **`packages/fiscal` stays free of Prisma and `SecretStore`**, so the boundary
  package keeps its current dependency shape and the worker keeps the wiring.

### Negative

- **Eight packages added in total** (two direct, six transitive from
  `fast-xml-parser`). `fast-xml-parser`'s 4.x line would add one instead of six;
  the trade was considered and the maintained line was chosen, with the
  footprint recorded rather than minimised on paper.
- **A TLS handshake per call**, because no socket is pooled. Deliberate.
- **One deployment, one DNIT environment**, which blocks mixed
  homologation/production tenants until a per-tenant environment decision is
  taken.
- **`FiscalProviderModule` stops being a plain `@Module`.** `forRoot()` is a
  one-line change at two import sites, but it is a change to the boundary's
  composition root and is recorded as such.
- **The SOAPAction stays open**, because the WSDL is unreachable. A service that
  requires one will fail until the action is pinned from a real source; this is
  recorded, not guessed.

## Migration / Rollout

No data migration. Two dependency additions to `packages/fiscal/package.json`,
one new port module, one dynamic-module change at two import sites. The
transport and the credential port land with [[FISC-010]], proven against a local
TLS double (a server that verifies the client's certificate); the real
credential implementation and the worker wiring land with [[FISC-012]], together
with the signing stage. Nothing in this ADR is reachable in production until
`SIFEN_DIRECT` is selectable, which is also [[FISC-012]]'s.

## Guardrails

1. **No pooled connection, ever.** `agent: false` on every call, and a test
   asserts two consecutive calls to two different credentials share no socket.
2. **A redirect is an error.** A 3xx response fails the call with its status and
   `Location`, and is never parsed — asserted with a double that redirects to an
   HTML page.
3. **The response is bounded before it is parsed**, and the DOCTYPE refusal is
   asserted on a body that carries one.
4. **Values are strings and are validated against published domains.** A test
   feeds a response whose `dEstRes` is an unknown string and asserts a refusal
   rather than a coerced outcome.
5. **The credential is read per call and never retained.** A test asserts the
   port is consulted once per call and that no field of the provider holds
   material between calls.
6. **A missing or expired credential is `CONFIGURATION_ERROR`**, terminal and
   non-retryable — asserted, because [[DEC-049]] makes configuration errors
   terminal and a retry loop on a missing certificate is the failure that never
   ends.
7. **The environment is never silently substituted.** A read for `PRODUCTION`
   against a tenant that only has `TEST` material returns `null`, and the
   adapter fails closed.
8. **No secret and no envelope is logged.** The private key is an argument of
   one call; errors carry a status and a bounded reason, never the body or the
   material.

## References

- `docs/06-fiscal/SIFEN-BASELINE.md` §7 (the transport stack), §8 (the endpoint
  table and the Manual's defective example), §11 (the one-minute response
  bound), §23 (the service schemas, the `xDE` divergence, the WSDL's 302 and the
  control probe).
- DNIT, _Guía de Mejores Prácticas para la Gestión del Envío de DE_, October
  2024 — the mutual-authentication requirement, the batch's ZIP+base64 steps,
  the 1000 KB request bound and the SOAP 1.2 envelope examples.
- `docs/04-adrs/ADR-005-tenant-signing-material-secretstore.md` — the RESTRICTED
  material this transport consumes; `ADR-006-xmldsig-signing-dependency.md` —
  the `lib="dom"` finding that refuses `@xmldom/xmldom`.
- `packages/fiscal/src/fiscal-provider.module.ts` — the static factory this ADR
  makes dynamic.
- `packages/database/prisma/migrations/20261004000002_fiscal_signing_material/migration.sql`
  — the `(tenant_id, environment) WHERE ACTIVE` index.
- `apps/api/src/secret-store/secrets.module.ts` — the credential boundary the
  worker does not have.
- `docs/02-stories/FISC-010-dnit-web-services.md` — the Story this gates, and
  `FISC-012` — the Story that implements the port and wires the worker.
