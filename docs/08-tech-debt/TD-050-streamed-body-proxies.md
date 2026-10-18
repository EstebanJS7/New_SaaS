---
id: TD-050
type: tech-debt
title: Twelve BFFs, two body-forwarding patterns, and one unexplained crash
status: resolved
severity: resolved
owner: web
related_epics:
  - EPIC-04
  - EPIC-06
  - EPIC-07
  - EPIC-12
  - EPIC-14
related_stories:
  - PORTAL-001
created: 2026-10-18
updated: 2026-10-18
---

# TD-050 — twelve BFFs, two body-forwarding patterns, and one unexplained crash

## The record this replaces, and why

This item was first written as _"two more proxies carry the defect TD-049
proved"_, on the inference that `clinical` and `scheduling` would fail the same
way the portal proxy did. **That inference is refuted, and the refutation is the
useful part.**

## What the investigation found

```text
Proxies that STREAM the body (`request.body` + `duplex: "half"`)
  clinical    scheduling    purchases    suppliers    patients    catalog

Proxies that BUFFER it (`await request.text()`)
  customers   sales         cash         billing      notifications   portal
```

The split follows the epics: the earlier proxies stream, the later ones buffer.
And the streaming in `clinical` and `scheduling` is **a deliberate,
test-enforced decision**, not an oversight:

```ts
// apps/web/src/app/api/clinical/[[...path]]/route.test.ts, in the request mock
// Buffering the request is the regression under test: any call is fatal.
text: () => Promise.reject(new Error("request.text() must not be called")),
```

Their suites fail if the proxy ever buffers. `Purchases.md` and `Suppliers.md`
describe the same contract in prose: _"piped as the caller's raw stream, never
buffered"_.

## The reproduction that refutes it

Against a real PostgreSQL 16, Redis, the built API and `next start`, **signed in
as staff** with the `OWNER` role, through the STREAMING `scheduling` proxy:

```text
POST /api/scheduling/appointments   {patientId, branchId, professionalMembershipId, startAt, endAt}
  -> 201 Created          the handler ran, read the body, and wrote an appointment
POST /api/scheduling/appointments/:id/cancel   (a route with NO `@Body()`)
  -> 201 Created
POST /api/portal/login             {tenantSlug, email, password}   (the same body shape that failed)
  -> 401 / 200            AFTER TD-049's fix
```

**So the streamed body worked**, for a request whose handler read it, on the
very pattern that crashed in the portal.

Two mistakes in the original record, kept here because the next reader will make
them too:

- **The first attempt tested `cancel`, which has no `@Body()`.** A route that
  never reads the body cannot exercise a body-forwarding defect, and the result
  looked like evidence when it was none.
- **The inference "same code shape, same defect" was never a test.** It is the
  shape of reasoning that produces churn: it would have changed two reviewed
  proxies (and reverted a decision another epic made and enforced) on the
  strength of a guess.

## What is actually open

**One observed crash, with no explanation.** `POST /api/portal/login` through
the streaming proxy failed with `expected non-null body source` for bodies that
reached the handler, and worked for bodies the validation pipe rejected — and
[[TD-049]] records what the instrumentation showed and what it ruled out. What
it never established is the trigger: the same pattern, the very same mechanism,
works in `scheduling`.

So the two patterns coexist **by decision**, and the decision is now a question:

1. **Unify on buffering** (6 proxies, their suites, and the "never buffer"
   contract that `clinical` and `scheduling` enforce), on the argument that a
   small JSON payload's buffer is nothing and one unexplained crash is one too
   many.
2. **Keep both** and treat the portal's crash as an open investigation, on the
   argument that the "never buffer" decision was made deliberately for reasons
   this record does not contain and that `scheduling` demonstrably works.

**That choice belongs to the maintainer**, and it is why this record is `medium`
rather than `high`: there is no reproduced defect to fix, only a divergence to
decide about.

## RESOLVED — unified on text, and verified per proxy

**The maintainer chose uniformity.** All six streamed bodies now read the body
as text, in one unit:

```text
clinical  scheduling  purchases  suppliers  patients  catalog
```

Each suite changed with it, and the changes are the interesting part: their
request mocks **rejected `request.text()` on purpose** ("Buffering the request
is the regression under test: any call is fatal"), and six cases were NAMED for
the decision — _"forwards the PUT body as the caller's raw stream without
buffering"_. A mock that refuses what the code is about to do, and a test whose
name asserts the mechanism, are how a decision outlives its rationale: nobody
can evaluate it, and no test can question it.

The mocks now derive `text()` **from the same body stream**, the way the runtime
exposes both, and the cases assert a **string with no `duplex`** — so a future
edit cannot quietly reintroduce the stream. The case names say what is being
tested rather than which mechanism was chosen.

**VERIFIED LIVE, per proxy**, against PostgreSQL 16, Redis, the built API and
`next start`, signed in as staff — because TD-050's own lesson is that an
inference from a code shape is not evidence:

```text
scheduling   POST /api/scheduling/appointments  201   the handler ran and wrote an appointment
suppliers    POST /api/suppliers                201   the handler ran and wrote a supplier
clinical     POST /api/clinical/:id/weights     400   the API's own validation envelope + its requestId
patients     POST /api/patients                 400   the API's own validation envelope + its requestId
purchases    POST /api/purchases                400   the API's own validation envelope + its requestId
catalog      POST /api/catalog                  400   the API's own validation envelope + its requestId
             PUT  /api/catalog/:id              404   the API's own not-found envelope + its requestId
```

Two of them prove the strongest form (the handler read the body and acted on
it); the other four prove that the body crossed into the API's own validation,
since the envelope carries the API's message and request id rather than the
proxy's.

**The decision that was replaced** is recorded above rather than deleted, and so
is the fact that its rationale was never written down. That is the durable
lesson: a decision whose _why_ is missing cannot be revisited by anyone but its
author, and a test named after the mechanism will defend it long after the
mechanism stops being right.

**What is still not explained**: the portal's crash trigger ([[TD-049]]).
Unifying removes the pattern that produced it, but not the ignorance about it.

## Related

- [[TD-049]] — the portal's crash, its fix, and what the instrumentation
  established.
- `docs/05-modules/Purchases.md`, `docs/05-modules/Suppliers.md` — the "never
  buffered" contract.
