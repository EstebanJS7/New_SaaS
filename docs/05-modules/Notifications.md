---
type: module
status: implemented
epic: EPIC-17
updated: 2026-10-17
---

# Notifications

Notifications owns the **intent to tell somebody something**: the delivery
aggregate and its lifecycle, the reminder policy, the channel boundary that
actually sends, the three emitters this epic added, and the staff read surface
that shows what happened. Notifications is a **Core** capability: it reads no
Veterinary aggregate, imports no Veterinary detail, and knows a recipient by
reference rather than by person.

Implemented by [[NOTIF-001]] (the aggregate and the queue contract),
[[NOTIF-002]] (the channel boundary and the delivery path), [[NOTIF-003]] (the
reminder, the emitters and the content builder) and [[NOTIF-004]] (the read
surface and the permission family), under [[DEC-058]], [[DEC-059]], [[DEC-060]]
and [[DEC-061]].

The documented behavior is implemented behavior, not a claim of production
readiness. **No delivery has crossed a real provider**: no SMTP credentials and
no WhatsApp Business account exist in this repository, so the adapters are
proven against the deterministic fake and their own unit cases, and the live run
is recorded **pending by name** in `docs/10-qa/CI-EVIDENCE.md`.

## Owned tables

```text
notification_delivery
```

One row is one **intent to deliver one message over one channel**, and it is the
only durable record of a notification. It carries the source by typed id pair
(`source_type`, `source_id` — the `audit_log` shape, because the sources span
EPIC-07's appointments and EPIC-16's fiscal documents and a fourth domain must
not need this table's schema changed), the recipient **by reference** only, the
instant it may run, its attempt summary, and — exactly when they apply — the
timestamps that make its status unable to disagree with itself.

There is no second table, no attempt log, and no message body. See [[TD-046]]
for the attempt log that does not exist and [[NOTIF-004]] for how that was
decided.

Four enums ship with it — `NotificationChannel` (`EMAIL`, `WHATSAPP`),
`NotificationDeliveryStatus`, `NotificationSourceType` and
`NotificationRecipientType` — plus four SQL guards the migration owns, because
Prisma cannot express them:

```text
notification_delivery_identity_immutable    the dedupe key, the source pair, the
                                            recipient pair and scheduled_at are fixed
                                            after insert
notification_delivery_guard                 the legal transitions only
notification_delivery_terminal_immutable    SENT and CANCELLED rows are frozen
notification_delivery_biconditionals        sent_at exactly when SENT; cancelled_at and
                                            cancellation_reason exactly when CANCELLED
```

Identity immutability is what makes the dedupe index mean what it says: a key
that could be edited after insert would make uniqueness a claim rather than a
guarantee.

## The lifecycle

```text
SCHEDULED ──► QUEUED ──► SENDING ──► SENT
    │            │           │
    │            │           └────────► FAILED ──► (retry) SENDING
    └────────────┴────────────────────► CANCELLED
```

- **`SCHEDULED`** is the created intent. For a reminder it exists before its job
  is enqueued, which is why the enqueue is retried by later events rather than
  trusted.
- **`QUEUED`** means a job exists for it.
- **`SENDING`** is a **claim**: the attempt's lease is `last_attempt_at`, and a
  fresh lease means another worker owns the attempt. A lease past its bound may
  be re-claimed in place — the status does not change, so the transition guard
  has nothing to refuse — and the guard refuses to **clear or rewind** the
  lease, because a rewound lease is a stolen claim and a stolen claim is a
  second message to a real recipient.
- **`SENT`** and **`CANCELLED`** are terminal and frozen.
- **`FAILED`** is where a retryable outcome settles. `attempt_count` and the
  bounded reason describe the last attempt.

**Transitions move through named commands, never through a status patch.** There
is no generic status route, on any surface, and the read surface's absence of a
command route is asserted by its own test suite.

## Dedupe semantics

A delivery's logical identity is `(source, channel, window)`, built by the
domain into `dedupe_key` and enforced per tenant by a **partial** unique index:

```sql
UNIQUE (tenant_id, dedupe_key) WHERE status <> 'CANCELLED'
```

- A reminder's window is the appointment's **start instant truncated to the
  minute**, so the key is stable for one start and a **reschedule to a different
  instant is a different window** — the key never silently suppresses a
  legitimately new reminder.
- A fiscal notice has no window: its key is `fiscal:<documentId>:<channel>`,
  because a notice confirms something that already happened.
- **`CANCELLED` is excluded from the index on purpose**: a cancelled delivery
  must not occupy its key forever, or a legitimate later intent could never be
  created.

The schedulers call **`ensureIntent`**, which returns the id it created **or the
pending delivery that already holds the key**, and the caller enqueues in either
case. That shape is deliberate and was a review finding: returning early on a
conflict meant a first enqueue that failed stranded the delivery
**permanently**, because every later event took the conflict branch. Enqueuing
twice is safe because the job id is deterministic and the handler refuses a
settled row.

## The queue

One queue, `notification-delivery`, with **two producers** — the API schedules,
the worker sends and also schedules the fiscal notice — so the transport lives
once, in `packages/notifications`, rather than being copied per producer.

The payload is the delivery's **id and nothing else**; the job id is
`notification-deliver-<deliveryId>`, deterministic so a duplicate add is a
no-op. Reminders are enqueued **delayed** to `scheduled_at`; a fiscal notice is
enqueued immediately.

A retried job whose row is already `SENT` or `CANCELLED` is a **no-op**: no
second message, no state regression.

## The channel boundary

```text
NotificationChannelPort
  ├── FakeNotificationChannel        deterministic, selectable on purpose
  ├── SmtpEmailChannel               nodemailer, one transport per send
  └── WhatsAppCloudChannel           the Cloud API over HTTPS
```

Selection is **fail-closed exactly as `FISCAL_PROVIDER` is**: a closed set of
accepted values, an unknown value refused **by name**, an absent value refused
in production, and **no silent fallback to the fake**. The fake stays selectable
when an operator types it deliberately — the refusal is about absence, not about
the fake.

The email dependency is [[ADR-011]]'s, and the guardrails are the decision: a
transport per send, `pool: false`, file and URL access disabled, no tenant
string in a transport option, one validated recipient, and the library imported
by exactly one file — which a dependency-boundary test enforces.

**The channel boundary is where RESTRICTED contact data lives.** The recipient
is resolved at send time, used to build the message, handed to the port, and
never persisted, logged, or returned.

## The settings namespace

`notifications` is a typed, versioned tenant-settings namespace: a closed
`z.object(...).strict()` schema, version 1, the reminder lead time bounded to
`1..168` hours with a default of **24**, and the channel set defaulting to
`EMAIL` alone. Writes require `notifications.settings.manage`; an unknown key is
refused server-side and **nothing is persisted**.

It sets **no `requiresFeature`**, and the absence is asserted so a later edit
cannot quietly gate the whole namespace behind a feature code ([[DEC-058]]):
email is ungated.

The namespace validates **shape only**, and that is a decision rather than an
omission — a value-level entitlement check is not expressible through
`requiresFeature`, and adding a hook to the shared settings service for one
namespace's convenience would change a reviewed contract. A `WHATSAPP` channel
therefore requires the tenant's `whatsapp` grant **at the scheduling boundary**,
and is re-asserted **at send time**, which [[DEC-058]] names as the
authoritative gate. A tenant can configure a channel it cannot use; nothing is
scheduled for it and nothing is sent.

## The emitters

Notifications publishes nothing and consumes three events, all after their
originating transaction commits, all carrying **ids only** and no contact datum:

```text
AppointmentConfirmed   apps/api    AppointmentService.publishTransition
AppointmentCancelled   apps/api    AppointmentService.publishTransition
FiscalApproved         apps/worker FiscalApprovalEmitter
PasswordResetRequested apps/api    PasswordRecoveryService (DAT-007)
```

`PasswordResetRequested` is the one **platform-level** event (`tenantId: null`,
which the envelope documents as the meaning of that value): a password reset
belongs to an IDENTITY, the credential it authorises is global to the profile,
and the request is anonymous - so there is no tenant to name. Its reaction
creates the delivery under the **platform tenant** (see below), and it is
published from the auth module, which consequently knows no queue, producer or
delivery table.

Rules this module follows and that a reader should hold it to:

- **The reaction is registered in the deployable that publishes the event**,
  because the dispatcher is **in-process**: a subscriber in another deployable
  would silently never fire. That is why the API owns the appointment reactions
  and the worker owns the fiscal one.
- **`FiscalApproved` is published from both paths that enter `APPROVED`** — the
  submission handler's `persistResult` and the reconciliation sweep's
  conditional update — through **one shared emitter both call**. A single
  publisher at one site would lose every approval the sweep resolves.
- **A payload built from the emit-time snapshot would be wrong.** The subscriber
  re-reads its source, which is what lets a reschedule before delivery produce a
  reminder with the **current** time rather than the enqueued one.
- **Only the transitions a subscriber exists for publish.** `no-show` publishes
  nothing: it is reachable only from `CONFIRMED` or `ARRIVED`, both at or past
  the appointment instant, so its reminder window has already closed.

| Event                    | Reaction                         | Effect                                                                                         |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `AppointmentConfirmed`   | reminder scheduler (api)         | one intent per configured channel, dedupe-keyed, delayed job                                   |
| `AppointmentCancelled`   | reminder scheduler (api)         | the intent reaches `CANCELLED` **and** its job is removed                                      |
| `FiscalApproved`         | fiscal notice scheduler (worker) | one `FISCAL_DOCUMENT` intent for the invoice's customer, email only, enqueued immediately      |
| `PasswordResetRequested` | recovery scheduler (api)         | one `STAFF_ACCOUNT` intent under the **platform tenant**, email only, one per profile per hour |

The cancellation's two halves are **independent and total**: the job removal is
unconditional, because `queue.remove` is idempotent and the compensation needs
it when the row is already cancelled, and a failed row write does not skip the
removal. Both report ids and an error's **name** only, never its message.

## The platform tenant, and why identity-scoped messages have an owner

`notification_delivery.tenant_id` is NOT NULL with a foreign key, and that is
exactly what makes a cross-tenant read impossible without anybody having to
remember to filter. A staff password-recovery email is not a tenant's message,
though: the credential it authorises is global to the profile, and the request
is anonymous - so there is no tenant in context and no fact that makes one of
the profile's memberships the right one.

The answer is a seeded **platform tenant** (slug `platform`), which keeps the
invariant and gives the message an owner. It is **not a customer**: no
memberships, no entitlements, no branding, and it must not be listed as a
tenant. What it owns is a delivery - and that delivery being invisible to every
tenant's operator is the **correct** property rather than a side effect: a staff
member's recovery mail is not their tenant's business.

The alternative considered and rejected was making the column nullable for
platform sources: it would weaken the tenancy guarantee for **every** row in
order to describe one.

## The portal recovery message (PORTAL-002)

The `PORTAL_ACCOUNT` source is the staff recovery's sibling with two
differences, both the identity's:

- **The recipient is a `PORTAL_HOLDER`**, resolved as the access's own
  `contactEmail` — the LOGIN id — tenant-predicated. The customer's primary
  contact may be a different address whose holder is not proven to be the
  account's owner, and sending the link there would let a holder of one address
  reset a session for another.
- **The delivery belongs to the CLINIC's tenant**, not to the platform one. The
  two tenancy answers are opposite and both correct: a staff member belongs to
  no tenant (their credential is global to the profile), so their message is
  platform-owned and invisible to every clinic; a portal holder IS a clinic's
  customer, so their message belongs to that clinic and its operators can see
  it.

The two schedulers' guards mirror each other for the same reason: the staff one
refuses an event with a TENANT (its message is platform-owned) and the portal
one refuses an event with NO tenant (a portal message must belong to a clinic —
a tenant-less one would file a customer's recovery mail under nobody).

## The staff recovery message

The `STAFF_ACCOUNT` source is built by its own branch, and two of its properties
differ from every other message here:

- **The recipient is resolved by profile id alone, with no tenant predicate.** A
  staff profile belongs to no tenant - they merely work in some - and the
  delivery's tenant is the platform one, which owns the message rather than the
  person.
- **The builder MINTS the token it puts in the message.** This is the one place
  it writes, and it is DAT-007's issuance model made concrete: content is built
  at send time, a plaintext token cannot be rebuilt from a digest, and the
  alternatives are all worse. Minting there also keeps the plaintext inside the
  one function that needs it, and makes the lifetime honest - it starts when the
  mail is sent, not when it was asked for.

Its link is built from `WEB_APP_BASE_URL`, a deployment input the worker's
schema **requires in production**: absent, a production worker would mail every
user a token pointing at `localhost`.

## The content builder

Content is built **at send time** from the source's current row, never stored
and never taken from a snapshot. The builder then **gates** — `CONFIRMED` or
`ARRIVED` for an appointment, `APPROVED` for a fiscal document — and an
unreadable or unsendable source fails **closed**. The gate is the guarantee; the
event is the optimisation. It renders in the tenant's timezone, in 24-hour form.

## Routes

```text
GET /notifications/deliveries            bounded list, allowlisted filters
GET /notifications/deliveries/:id        one delivery and its attempt summary
```

The query is a **closed** schema — `status`, `channel`, `sourceType`,
`sourceId`, `limit` — so an unknown key is refused rather than ignored, `limit`
is bounded to `1..100` with a default of 50, and an oversized value is refused
rather than silently clamped. The order is deterministic, so a page is a page.

**There is deliberately no command route.** This epic adds no delivery
transition from the surface and `ENGINEERING-RULES.md` forbids a generic status
patch, so the permission family is `notifications.delivery.read` plus
`notifications.settings.manage` and there is no `delivery.manage` key: a
permission guarding a command nobody can call is one no operator can be denied
by.

The **detail** carries the delivery's attempt HISTORY ([[TD-046]]): bounded to
the newest twenty, chronological, and read only after the delivery is known to
exist and to belong to the caller. The **list** deliberately carries none — a
per-row history there is an N+1, and the assertion that the list stays one query
per page lives in the suite rather than in a comment.

The projection is an **allowlist** — named columns, an explicit mapper, and a
recipient **reference** — so no Prisma model is serialized and a column added
later cannot leak by appearing.

## Does Not Own

- **The customer's contact data.** Resolved at send time through the channel
  boundary. Classified RESTRICTED, never persisted here, never logged, never in
  a job payload or a response.
- **The source aggregates.** An appointment's status, an invoice's, a fiscal
  document's — read, never written.
- **The tenant's entitlement state.** Read through the entitlement port.
- **The message catalogue.** A reminder and a notice are fixed transactional
  messages; there is no tenant-editable copy.
- **Delivery transitions from a human.** No re-drive, no manual retry, no status
  patch.

## Audit and classification

| Material                                   | Class          | Where it may appear                           |
| ------------------------------------------ | -------------- | --------------------------------------------- |
| Contact value (address, phone)             | **RESTRICTED** | the channel boundary, at send time, in memory |
| Message content                            | INTERNAL       | built at send time, never stored              |
| Delivery row (references, status, reasons) | INTERNAL       | the read surface, allowlisted                 |
| Job payload                                | INTERNAL       | the delivery id                               |
| An error's message                         | —              | **never**; `describeError` records its name   |

**No notification action is audited**, and that is a decision rather than a gap:
PRD §27 does not list a notification delivery among the critical audited
actions, and the delivery row IS the trace — it carries who it was for, by
reference, what happened and when. The appointment's and fiscal document's own
audit rows are unchanged by the emitters; publishing an event adds no second
audit row.

## Tests

```text
packages/notifications        84   the policy (reminder, fiscal notice and staff
                                   the channel boundary and the dependency fence
apps/worker                  226   the delivery handler, the readers, the content
                                   builder, the fiscal notice and the emitter
apps/api                    1269   the settings namespace, the schedulers, the read
                                   surface and its isolation
packages/database            512   the aggregate's guards, the partial index and the
                                   seed catalog
```

## Known limitations

- **No delivery has crossed a real provider.** The live run is pending and named
  in `docs/10-qa/CI-EVIDENCE.md`; the fake carries the test evidence (the
  [[FISC-013]] precedent).
- **`AppointmentRescheduled` is not in PRD §39's catalog and is not invented
  here.** A reschedule leaves the previous window's pending job in place; the
  send-time content read bounds the damage to a duplicate, never a wrong time.
  Closing it needs a catalog decision.
- **The delivery row keeps a SUMMARY** — a count, the last instant and the last
  reason — and the SEQUENCE lives in `notification_delivery_attempt`, readable
  on the detail ([[TD-046]]). The summary is still what the list shows, and that
  is deliberate: "did it work" is what a list is for.
- **The attempt log stores the already-bounded reason, never the provider's raw
  error.** The raw text is RESTRICTED material this epic keeps out of every
  stored field, and it would need sanitizing anyway — a provider's error can
  echo the destination or the body — at which point it is not raw and the
  diagnostic value is gone.

- **Nothing links to the recovery REQUEST yet**: the message's destination
  exists (`/reset-password`), but the app has no login page, so a user has no
  way to ASK for a recovery from the UI — [[TD-048]]. The API and the message
  are complete; the entry point is a later Story's.

- **A recovery message is email-only.** `appointmentReminderChannels` is named
  for the reminder, and stretching it to cover this message would change what a
  stored setting means without anybody deciding it.
- **A `FAILED` delivery cannot be re-driven.** [[TD-029]]'s shape, and this epic
  does not invent a primitive for it.
- **A reminder names the branch and the instant, not the patient.** Naming the
  patient would need the recipient port to grow a second method; that is a
  decision.
- **The reminder's lead time is the only configurable policy.** The message copy
  and the notice's channel are fixed.
- **Nothing here is audited** — see above; the delivery row is the trace.

## Related Stories

- [[EPIC-17]] — the epic, with all five Stories `done`.
- [[DEC-058]] — the entitlement decision: email ungated, WhatsApp behind the
  existing key, no thirteenth feature code.
- [[DEC-059]] — the scope decision: this epic publishes the three emitters, and
  the EPIC-07/EPIC-16 crossings stay boundary debt.
- [[DEC-060]] — the reminder policy.
- [[DEC-061]] — the channel boundary.
- [[ADR-011]] — the transactional-email dependency.
- [[ADR-003]] — the internal-events mechanism the emitters use.
