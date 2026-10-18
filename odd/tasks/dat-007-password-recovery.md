# DAT-007 — Staff password recovery (feature tasks)

Resolves [[TD-004]]. Lives in [[EPIC-01]], reopened by the maintainer on
2026-10-17. Decisions taken before the first write: the Story lives in EPIC-01,
and the reset email goes through the **Notifications aggregate** rather than
directly through the channel port.

## Work units

- [ ] **WU-A — the token's data foundation.** `PasswordResetToken` model: the
      profile, the token **hash**, `expires_at`, `consumed_at`, `created_at`.
      Four SQL guards (single use, expiry, immutability of the hash and the
      expiry, and no un-consume). One additive migration. Schema cases against
      the live guards in `packages/database`. **No tenant column, and the reason
      is an invariant**: the credentials it authorises are global to the
      profile, not to a membership.
- [ ] **WU-B — the token service.** Issue (generate, hash, store, return the
      plaintext once) and consume (look up by hash, refuse an expired or
      consumed one uniformly, mark consumed). The hashing convention follows
      `session.service.ts`, whose records the same problem: a high-entropy token
      needs a fast digest, not argon2 — argon2 is for a password a human chose.
      Unit cases for every refusal path.
- [ ] **WU-C — the two routes.** `POST /auth/forgot-password` (rate-limited,
      uniform response, creates the delivery **intent**, no external call) and
      `POST /auth/password-reset` (consume, replace the argon2id hash,
      invalidate **every** session for the profile, audit both). The fence in
      `auth.integration.test.ts` is **inverted**.
- [ ] **WU-D — the notification wiring.** Two enum values (`STAFF_ACCOUNT`,
      `STAFF`) in the same migration, a staff recipient reader, and the message.
      **The token is issued at send time**, so the plaintext never reaches a
      table and its TTL starts when it is delivered — the same shape as the
      reminder's send-time content, and the reason a hashed-at-rest token can
      still be put in a URL.
- [ ] **WU-E — the documentation.** `Identity-Sessions.md` and
      `Notifications.md`, the Story's evidence, [[TD-004]] closed, the epic's
      Stories and the ROADMAP.

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
