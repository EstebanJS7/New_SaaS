---
id: ADR-011
type: adr
title: The transactional email dependency
status: accepted
date: 2026-10-17
supersedes: []
superseded_by:
related_epics:
  - EPIC-17
related_decisions:
  - DEC-058
  - DEC-061
related_stories:
  - NOTIF-002
approval_record:
  decision_proposal: ADR-011
  decision_status: accepted
  decision_approval_date: 2026-10-17
---

# ADR-011 — The transactional email dependency

## Decision Summary

The `EMAIL` channel sends over **SMTP** with **`nodemailer`**, pinned to
`^10.1.2`, as a direct dependency of `packages/notifications`.

**Accepted by the maintainer on 2026-10-17**, over the two alternatives below:
the HTTPS-provider-without-a-dependency route (Option B) and the vendor SDKs
(Option D).

It is the only new runtime dependency this Story adds, and it is the smallest
one available: `nodemailer@10.1.2` declares **zero runtime dependencies** —
`dependencies: {}` in the published manifest, not "no direct dependencies" — is
**MIT-0** licensed, is pure JavaScript with no `gypfile` and no build step, and
requires Node `>=20.0.0`, which every deployable already exceeds.

**The advisory record is the reason this ADR exists at all, and it is not
reassuring.** The GitHub advisory database carries **25 advisories** for this
package on npm, **10 of them published since 2026-09-01** — three weeks before
this decision. They are not theoretical for this product:

| Advisory            | Severity | Component                              | Affects             |
| ------------------- | -------- | -------------------------------------- | ------------------- |
| GHSA-6vj9-mwq6-2f5v | medium   | transport / DNS cache                  | `>=5.0.0, <10.0.2`  |
| GHSA-prgh-xp8r-p3m5 | high     | addressparser (O(n²))                  | `>=9.1.0, <=10.0.4` |
| GHSA-v53p-9fqp-m79j | high     | addressparser backtracking             | `<=10.0.5`          |
| GHSA-g57g-f23g-4646 | medium   | RFC 5322 comment parsing               | `>=9.1.0, <10.0.9`  |
| GHSA-8vvx-rff5-p5rq | medium   | recipient array depth                  | `<10.0.2`           |
| GHSA-wmmp-3585-3rmp | medium   | IDN/Punycode allow-list                | `<9.1.0`            |
| GHSA-cc9r-2j5m-2m83 | medium   | recipient-domain validation            | `>=6.9.16, <9.1.0`  |
| GHSA-8m3c-c648-2xjj | medium   | `resolveContent()` / file & URL access | `<=9.1.0`           |

The first row is the one that decides a multi-tenant product: _"Process-global
DNS cache reuses TLS `servername` across transports, enabling **cross-tenant
SMTP credential disclosure**"_. That is precisely the failure this SaaS cannot
have, and it is a property of **how the library is used** as much as of the
version — which is why the guardrails below are part of the decision rather than
a footnote to it.

**`10.1.2` is past every one of those patches** (the highest patch line in the
list is `10.0.9`; nothing published affects `>=10.1.0` as of 2026-10-17), and
this ADR pins a **floor** rather than a range so a consumer cannot resolve to an
older, affected build.

## Context

[[DEC-061]] ships the channel boundary complete — one port, a deterministic
fake, the real adapters behind it, fail-closed selection — and it states that
**the email library's choice is architectural and requires this ADR**, exactly
as [[ADR-006]] treated the signing library. `AGENTS.md` requires a concrete
requirement before a new dependency, and sending transactional email is one: PRD
§24 names `EMAIL` as a channel, and [[TD-004]]'s password reset is blocked on
it.

Two inputs shape the decision and neither is negotiable by preference:

- **No operator credentials exist.** The live run is recorded pending and named
  ([[DEC-061]]), so nothing here may depend on a particular provider's account
  being available at development time. That rules out any design whose only path
  is a vendor SDK keyed to one vendor's account.
- **The tenants are the reason this is a SaaS.** A notification is addressed to
  a recipient our own rows name; the recipient's contact datum is RESTRICTED
  (PRD §41) and never enters a job payload, a log or a response.

## Why an ADR is Required

- `AGENTS.md`'s Complexity Budget lists a new dependency as requiring a concrete
  requirement, and this one sits in a **provider boundary** that
  `DOCUMENTATION-RULES.md` classifies as architectural.
- It is a **security-relevant dependency in a multi-tenant process**: the code
  that opens the outbound connection is shared by every tenant at once, and the
  advisory above shows that its transport handling has had exactly that failure.
- [[NOTIF-002]] states that **no email dependency lands before this ADR is
  `accepted`**.

## Decision

**`nodemailer`, pinned `^10.1.2`, as a dependency of `packages/notifications`.**
The SMTP transport is configuration, not code: the host, port and credentials
come from the deployment's environment at the boundary, and the adapter holds
none of them.

The port stays channel-agnostic. The library is reached from one file — the
`EMAIL` adapter — and no other module imports it.

**What it does not decide.** SMTP is a protocol, so this ADR does not choose a
provider, a sending domain, or whether a later Story offers per-tenant SMTP
credentials. Platform-level credentials from the environment are what the
operator supplies today ([[DEC-061]]); a per-tenant sending identity is a
product decision that would use the `SecretStore` [[ADR-005]] built, and it is
out of scope here.

## Alternatives Considered

### Option A — `nodemailer` over SMTP (chosen)

Chosen. Portability is the deciding factor: SMTP is a **protocol, not a
vendor**, so the operator can point the deployment at any provider or at the
tenant's own MTA, and no request or response shape of a third party enters our
code. It is also the smallest dependency that solves this: zero transitive
packages means no supply chain beyond the one package this ADR names, and MIT-0
is the most permissive licence in the comparison. The vendor path would put a
commercial API's schema between us and the only requirement PRD §24 states.

Its cost is real and is recorded under Consequences: an actively-adviseried
component whose parser and transport handling must be used defensively.

### Option B — no dependency: an HTTPS provider API over global `fetch`

Viable, and the honest runner-up. Node 22 has `fetch`; a transactional send is
an authenticated JSON POST; the `WHATSAPP` adapter is an HTTPS call either way,
so the two adapters would share one mechanism, one retry shape and one test
harness. It also **eliminates the class of risk the Sept-2026 cluster is about**
— there is no transport cache, no TLS `servername` reuse, no SMTP connection
state to share between tenants.

Rejected as the _recommendation_ because it trades a supply chain for a **vendor
lock-in**: our adapter would encode one provider's URL, auth scheme and error
taxonomy, the portability of SMTP would be gone, a tenant with its own mail
server could never be served, and "we have no credentials at development time"
becomes "we cannot test against the real shape at all". The repository rejected
exactly that trade for fiscal in [[EPIC-16]], and the same reasoning applies
here with less regulatory pressure.

**It remains the strongest alternative if the maintainer weights dependency
count above portability.** The port makes the swap an adapter change; nothing
else in EPIC-17 depends on this choice.

### Option C — hand-rolled SMTP on `node:net` / `node:tls`

Rejected. EHLO, STARTTLS negotiation, the AUTH mechanisms, MIME encoding, header
folding and dot-stuffing are a protocol implementation, and this one carries
credentials and delivers to third parties. No dependency is saved that is worth
that surface — the [[ADR-006]] argument against hand-rolling signing applies
here with a larger wire format.

### Option D — a vendor SDK (`resend`, `@sendgrid/mail`, `mailgun.js`)

Rejected as the recommendation, for Option B's reason plus one more: an SDK
still adds a dependency (and its transitive tree), so it gives up Option A's
"zero transitive packages" _and_ Option B's "no dependency". It is the worst of
both unless a specific vendor feature is required, and none is.

## Consequences

### Positive

- **One package, zero transitive dependencies**, MIT-0, pure JavaScript, no
  build step, no native binding — nothing new to install for the packaging story
  and nothing to compile for the deployables.
- **Protocol portability**: the operator supplies an SMTP endpoint, and the same
  adapter works with a provider, a corporate relay or the tenant's own server.
- **Coverage we do not have to own**: STARTTLS, AUTH, MIME and encoding are the
  library's, and their failures are its bugs rather than ours.
- **Testability is unaffected**: the port's deterministic fake carries the
  suite, so the boundary is exercised without a network ([[DEC-061]]).

### Negative

- **An active advisory history in the exact components we would use.** 10
  advisories in three weeks, including a multi-tenant credential disclosure and
  three DoS issues in the address parser. Mitigated by the guardrails below and
  by a pinned floor, but it is a maintenance obligation: this dependency must be
  updated on its security releases, not on a convenience schedule.
- **A dependency in a multi-tenant process**, which is what the first guardrail
  is about.
- **One more dependency for the AV/supply-chain record**, even if it is the
  smallest available: zero transitive packages is not zero packages.
- **SMTP is not free of provider specifics either** — a provider's relay may
  require particular AUTH or header handling — but those are configuration
  differences rather than an API schema in our code.

## Migration / Rollout

No data migration. The dependency lands with [[NOTIF-002]], whose adapter is
exercised by the deterministic fake. The live run against a real SMTP endpoint
is an **operator act** and is recorded as pending and by name until credentials
exist ([[DEC-061]]), exactly as the fiscal epic recorded its certification run.

## Guardrails

These are the decision, not advice. Each corresponds to a failure the advisory
record already produced once.

1. **The version floor is `10.1.2`.** A floor rather than a range, so no
   consumer resolves to an affected build, and a test pins it. The patch lines
   that fixed the Sept-2026 cluster are all below it.
2. **Never share a transport across tenants.** The adapter creates the transport
   per send, or keeps one per tenant; a process-global or tenant-agnostic
   transport is forbidden, because that is the shape of the cross-tenant
   credential disclosure above. Volume here is transactional — a reminder per
   appointment — so a per-send connection is affordable, and correctness wins.
3. **`disableFileAccess` and `disableUrlAccess` are always on**, so a message
   can never make the library read a file or a URL (GHSA-8m3c-c648-2xjj).
4. **No tenant-supplied string reaches a transport option.** The `name` option's
   CRLF advisory is a command-injection vector; host, port, auth and name come
   from the deployment's environment only.
5. **Exactly one recipient address per send, and it comes from our own rows.**
   The address-parser advisories describe attacker-controlled address _lists_;
   the adapter is given one address resolved from a `CustomerContact` reference,
   validated by our own strict schema before it reaches the library. No request
   body and no job payload ever carries an address list.
6. **The contact datum never leaves the call frame**: not into a log, not into
   an error, not into the delivery record, not into a job payload (PRD §41).
7. **The library is imported by one file.** A repository search proves no other
   module reaches it; the port is the only contract the rest of the system sees.

## References

- `docs/07-decisions/DEC-061-notification-channel-boundary.md` — the boundary
  whose email library this decides, and the requirement that this ADR precede
  the dependency.
- `docs/07-decisions/DEC-058-notification-entitlements.md` — email is ungated;
  this decision adds no feature code.
- `docs/04-adrs/ADR-006-xmldsig-signing-dependency.md` — the precedent for
  treating a library choice as architectural, including the licence and advisory
  record.
- `docs/04-adrs/ADR-005-tenant-signing-material-secretstore.md` — the
  `SecretStore` a per-tenant SMTP identity would use if that is ever decided.
- `docs/00-product/PRD.md` §24 (the channels) and §41 (classification).
- `docs/02-stories/NOTIF-002-channel-port.md` — the Story this gates.
- Advisory data retrieved from the GitHub advisory API on 2026-10-17:
  `api.github.com/advisories?ecosystem=npm&affects=nodemailer` (25 entries, 10
  published since 2026-09-01, newest 2026-09-30, none affecting `>=10.1.0`), and
  the package manifest at `registry.npmjs.org/nodemailer/latest` (`10.1.2`,
  `MIT-0`, `dependencies: {}`, `node >=20.0.0`).
