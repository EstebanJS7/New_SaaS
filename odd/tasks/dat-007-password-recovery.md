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
- [~] **WU-C — the two routes.** Split in two, because the halves have different
  risks. **C1 (the request half) is DONE**; C2 (the reset) follows. _C1, commit
  pending: the `platform` tenant is seeded (a singleton that owns
  identity-scoped messages, not a customer); `POST /auth/forgot-password`
  answers `202 {status:"accepted"}` **byte-equivalently** for a known and an
  unknown address and for a profile with no credentials; the rate limit is keyed
  by address AND IP so one attacker cannot lock a victim out; and the request
  **publishes `PasswordResetRequested`** — `tenantId: null`, which the envelope
  documents as the meaning of that value — instead of talking to the delivery
  aggregate. The notification module's `PasswordRecoveryScheduler` subscribes
  (in the API deployable, because the dispatcher is in-process), resolves the
  platform tenant, creates the intent with a per-hour window key and enqueues
  it. **Two things the work uncovered.** (1) The first design had `AuthModule`
  import `NotificationsModule`, which does not work: it is a DYNAMIC module, so
  importing the class yields nothing, and calling `forRoot()` a second time
  would instantiate the producer and the reminder scheduler TWICE. The event
  dissolved the whole tangle, and the auth module now depends on no notification
  anything. (2) The credential check was `=== null`, which a delegate that does
  not model the relation would answer with `undefined` — reading "no
  credentials" as "has credentials" and mailing a reset link for a password that
  does not exist. It is falsy-safe now, and the in-memory harness not modelling
  `user_credential` is what surfaced it. Evidence: 9 service cases + 7 scheduler
  cases (including that the subscriber is REGISTERED, and that a failure logs
  the error's NAME and never its message), 3 policy cases in the package, the
  fence narrowed and the byte-equivalence asserted over real HTTP, and the new
  route pinned in the route-contract inventory. **Not covered yet**: the
  full-app end-to-end (route -> event -> delivery row + enqueue), because the
  in-memory Prisma harness does not model `user_credential`; it is the first
  thing C2 or WU-D must close._
- [ ] **WU-D — the notification wiring.** Two enum values (`STAFF_ACCOUNT`,
      `STAFF`) in the same migration, a staff recipient reader, and the message.
      **The token is issued at send time**, so the plaintext never reaches a
      table and its TTL starts when it is delivered — the same shape as the
      reminder's send-time content, and the reason a hashed-at-rest token can
      still be put in a URL.
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
