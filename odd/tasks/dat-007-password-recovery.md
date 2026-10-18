# DAT-007 — Staff password recovery (feature tasks)

Resolves [[TD-004]]. Lives in [[EPIC-01]], reopened by the maintainer on
2026-10-17. Decisions taken before the first write: the Story lives in EPIC-01,
and the reset email goes through the **Notifications aggregate** rather than
directly through the channel port.

## Work units

- [x] **WU-A — the token's data foundation.** `PasswordResetToken` model: the
      profile, the token **hash**, `expires_at`, `consumed_at`, `created_at`.
      Four guard families (identity immutability, single use with the rewrite
      and the clear refused separately, and a CHECK that the expiry is after the
      creation). One additive migration that also appends the two delivery enum
      values. 13 schema cases in `packages/database` (525). **No tenant column,
      and the reason is an invariant**: the credentials it authorises are global
      to the profile, not to a membership. _Commit `06e0791`. Proven live on a
      disposable PostgreSQL 16: all 46 migrations in one pass, and the guards
      refused an expiry before its creation, a duplicate digest, a second
      consumption instant, an un-consume, an extended expiry, a repointed digest
      and a reassigned profile — while a fresh token consumed once, deleting a
      profile cascaded, and the two new enum values were usable as literals in a
      later transaction with the delivery aggregate's identity guard still
      holding._
- [x] **WU-B — the token service.** `password-reset-token.service.ts`: `issue`
      (32 random bytes base64url, stores the **digest only**, returns the
      plaintext once), `consume` (a **compare-and-set**, so two requests with
      one link cannot both win) and `spendAllForProfile` (what makes "after a
      reset no other link works" true). SHA-256 rather than argon2, with the
      reason stated: argon2 exists to make a LOW-entropy human-chosen password
      expensive to guess, and there is nothing to guess in 256 random bits. The
      refusal is ONE code and ONE message for an unknown, a spent and an expired
      token, and a non-string token is refused without querying at all. _Commit
      pending. 11 cases: the digest is what is stored (asserted over the whole
      serialized write, so any field would catch it), the TTL is computed from
      the instant passed and not the wall clock, the CAS's `WHERE` carries the
      conditions the read saw, a lost race refuses, the three causes refuse
      IDENTICALLY, the expiry boundary is exact at the millisecond, and
      `spendAllForProfile` leaves already-spent rows alone._
- [x] **WU-C — the two routes.** Both halves done. _C1 (`7d4d687`) is the
      request; C2 is the reset, committed below._ **C2**:
      `POST /auth/password-reset` consumes the token, replaces the hash, ends
      **every** session for the profile, spends the profile's other links and
      audits — **in one transaction** — and the hash is computed BEFORE it
      opens, because argon2 at the OWASP floor costs tens of milliseconds of
      deliberate CPU and holding a transaction across it would hold locks for
      that whole time. The token is spent INSIDE, so a later failure rolls the
      spending back instead of burning the link against a password that never
      changed. The refusal reuses the login's own vocabulary (401
      `UNAUTHENTICATED`, one message) because the old FENCE that asserted both
      routes answer `NOT_FOUND` is now **fully inverted** into behavior. A
      shared unit reading three tables is the price of that atomicity, and the
      cheaper price: the alternative threads a transaction client through two
      services and puts the boundary in three signatures instead of one comment.
      Evidence: 8 reset cases that assert the STATEMENT ORDER (hash → begin →
      find → CAS → credential → sessions → other links → audit), that the
      transaction's delegates did the work and the ambient client was never
      consulted, that the session `WHERE` is `{ userProfileId }` (all of them,
      not the caller's), that an unusable token refuses with `UNAUTHENTICATED`
      and touches nothing after the lookup, and that the audit record carries no
      token and no hash. Plus the fence inverted over real HTTP, with the route
      pinned in the route-contract inventory. **Still open**: the full-app
      end-to-end (route → event → delivery row + enqueue) needs the in-memory
      Prisma harness to model `user_profile.findUnique`, `user_credential` and
      `staff_session.deleteMany({ userProfileId })`; it is named as WU-D's first
      task rather than left implied. **A limitation this unit recorded rather
      than decided**: this repository has NO password policy, so the new
      password is bounded by length alone (mirroring the login body). Inventing
      a complexity rule in an implementation would be a product decision taken
      by a work unit.
- [x] **WU-D — the notification wiring.** Both halves done. _D1 (`6d34778`)
      closed the end-to-end gap; D2 is committed below._ **D2**: the worker's
      recipient reader resolves a `STAFF` recipient **by profile id alone, with
      no tenant predicate** — a staff profile belongs to no tenant (they merely
      work in some) and the delivery's tenant is the platform one, which owns
      the MESSAGE rather than the person — and the content builder gained the
      `STAFF_ACCOUNT` branch: it gates on the profile's own credential, **mints
      the token AT SEND TIME**, stores only its digest and puts the link in the
      message. The token's lifetime therefore starts when the mail is sent, and
      the plaintext exists inside one function and nowhere else. **The
      primitives moved to the shared kernel** (`@newsaas/shared`): the API's
      request path and the worker's send path must agree on entropy, digest and
      lifetime, and two copies is how the two would drift. The API's token
      service re-exports them, so every existing import site still reads them
      from the auth boundary. **A new deployment input**: `STAFF_APP_BASE_URL`,
      optional in development and **required in production** by the schema's
      gate — absent, a production worker would build `http://localhost:3000`
      links and mail every user a token pointing at a host that is not their
      app. The gate has its own cases. Evidence: 2 reader cases (the id-only
      `WHERE`, and a missing profile settling rather than retrying) and 5
      builder cases (the digest-only write, the link built from the configured
      origin with the plaintext absent from both the row and the digest, the two
      refusals that mint nothing, and the id-only read), plus 3 gate cases.
      worker 236, api 1313, notifications 84, database 525, shared 16. **A
      limitation this unit names**: the link points at `/reset-password`, a page
      the web app does not have yet. The message is right and the destination is
      a later Story's; saying so is better than a dead link nobody mentioned.
- [x] **WU-E - the documentation.** `Identity-Sessions.md` gained the two
      routes, the `PasswordResetToken` entity with its four guards, the recovery
      budget, a "The recovery flow" section stating the three things a changer
      must know (the request sends nothing, the token is minted at send time,
      and a reset ends every session), and the invariants the fence used to
      deny. `Notifications.md` gained the platform-level event, the **platform
      tenant** with the alternative that was rejected, the staff message with
      its two different properties, and the `STAFF_APP_BASE_URL` gate.
      [[TD-004]] is **resolved** with the evidence gate mapped item by item
      against what landed, and [[TD-048]] carries the two open ends the Story
      named: the page the link points at, and the password policy nobody has.
      EPIC-01 closed again with its re-opening kept in the record, the ROADMAP
      row follows, and the CHANGELOG entry is written. The Story's ACs are all
      checked and its verification carries the closure searches: the event has
      one publisher and one subscriber in the SAME deployable, no contact datum
      reaches a log or a job payload, and no token is logged.
      `Notifications.md`, the Story's evidence, [[TD-004]] closed, the epic's
      Stories and the ROADMAP.

## Decisions taken while working

**The delivery's tenant (asked, not guessed).**
`notification_delivery.tenant_id` is NOT NULL with an FK, and that is why a
cross-tenant read is impossible without anyone having to remember to filter --
but the reset mail is an IDENTITY's, and the request is anonymous, so there is
no tenant to take from the context and no fact that makes one of a profile's
memberships the right one. Three options were put to the maintainer (a platform
tenant; an arbitrary membership tenant; making the column nullable), and the
maintainer chose **a seeded platform tenant** (slug `platform`): the aggregate
keeps its invariant, the message has an owner, and the delivery being invisible
to every tenant's operators is the CORRECT property rather than a side effect --
a staff member's recovery mail is not their tenant's business.

## The one design decision worth writing down before the code

**The token is generated when the message is sent, not when it is requested.**
The delivery's content is built at send time from the source's current row
(EPIC-17's rule), and the aggregate stores no message. A plaintext token cannot
be rebuilt from a hash, so issuing at request time would force one of three bad
shapes: persist the plaintext (RESTRICTED in a table), carry it in the job
payload (forbidden), or send inline from the request (an external call in the
request path, and no retry). Issuing at send time dissolves all three, and it
makes the token's TTL honest: it starts when the mail is sent.

Its dedupe key is per `(profile, window)` — the reminder's shape — so a second
request inside the window produces one message rather than a second one, which
is also what keeps the endpoint from being an email amplifier.

## Post-closure: TD-048 resolved

`/reset-password` exists, so the message's link is no longer a 404, and the
password policy is decided (minimum 8, no composition, enforced at the
credential boundary). Three things building it uncovered, all recorded in
TD-048: the page needed **reserving in the middleware** (any unreserved first
segment is a portal tenant slug, so it was squatting on that namespace), it
needed the app's **first public BFF** (no session, one allowlisted shape, so
login and logout stay unreachable), and it lives outside the `(app)` shell. What
remains open is a DIFFERENT dead end: **nothing links to the recovery request**,
because the app has no login page.

## Open questions

- **None that block WU-A.** The route names are settled by the existing fence
  (`forgot-password`, `password-reset`) rather than by TD-004's draft, and the
  token's TTL is proposed at 30 minutes in WU-B with its rationale, amendable
  there.
