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
- [~] **WU-D — the notification wiring.** Two halves: **D1 (the end-to-end gap)
  is DONE**; D2 (the staff recipient reader and the message) follows. _D1,
  commit pending: the in-memory Prisma harness gained the three pieces its
  absence was hiding — `user_profile.findUnique` by email composing the
  credential relation, `user_credential` (create/findUnique/update),
  `password_reset_token` (create/findFirst/updateMany honouring the CAS's own
  conditions) and `staff_session.deleteMany` **by profile**, not only by token.
  Then seven end-to-end cases over the real app: a request becomes a delivery
  under the PLATFORM tenant and is enqueued; an unknown address creates nothing
  and answers the same; a repeat inside the window leaves ONE delivery and every
  enqueue names the same job identity; the request is audited without the
  address; an unusable token changes nothing; a real token changes the hash to a
  genuine argon2id value with the configured parameters, ends BOTH sessions,
  makes the profile's other link refuse, and audits once with no token and no
  hash; and the spent token cannot be replayed._ **What this closes**: the
  dispatcher is in-process, so "the subscriber is registered somewhere else"
  would be a silent, total failure of the feature. This is where that is not
  silent — and it is the gap the two previous units named rather than implied.
  **D2, still pending**: the worker's staff recipient reader (the profile's
  email, resolved at send time, RESTRICTED like every other contact datum) and
  the message itself — which needs the token minted AT SEND TIME, the DAT-007
  issuance decision that keeps a plaintext token out of every table.
- [ ] **WU-E — the documentation.** `Identity-Sessions.md` and
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

## Open questions

- **None that block WU-A.** The route names are settled by the existing fence
  (`forgot-password`, `password-reset`) rather than by TD-004's draft, and the
  token's TTL is proposed at 30 minutes in WU-B with its rationale, amendable
  there.
