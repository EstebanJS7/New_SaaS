# Delta for rbac-administration

## ADDED Requirements

### Requirement: Role catalog listing with permission sets

The API SHALL expose `GET /rbac/roles` returning the six fixed PRD §9 roles,
each with its EFFECTIVE permission keys for the CALLER'S tenant — the platform
baseline mapping merged with that tenant's override verdicts (DEC-003) — via a
response DTO (never raw Prisma models). The route SHALL be permission-protected
by the catalog key `users.membership.manage`.

#### Scenario: Roles listed with mapped keys

- GIVEN an authenticated member holding `users.membership.manage`
- WHEN `GET /rbac/roles` is called
- THEN the response lists exactly the six seeded roles, each carrying its
  tenant-EFFECTIVE set of catalog permission keys (baseline merged with the
  caller's tenant overrides)

### Requirement: Tenant-scoped permission-set update with replace-set semantics

The API SHALL expose a role permission-set update command
(`PUT /rbac/roles/:code/permissions`) that atomically REPLACES the role's full
EFFECTIVE key set FOR THE CALLER'S TENANT, scoped exclusively by the
server-resolved tenant context (cross-tenant writes are structurally
inexpressible; one tenant's write never affects another tenant's view of the
same global role). The command SHALL materialize the diff against the platform
baseline as per-tenant override verdicts (requested−baseline ⇒ granted=true;
baseline−requested ⇒ granted=false), leaving global `role_permission` rows
untouched (DEC-003). Request keys SHALL be validated against the immutable
seeded permission catalog — unknown keys are rejected with `VALIDATION_FAILED`
and the stored state is left unchanged. Only the six fixed role codes are
addressable: the API SHALL offer no create/update/delete of roles or catalog
permission entries (catalog remains seed-owned code). The reference seed SHALL
stay idempotent after administrative edits (no duplicate rows or identity
changes); seed reruns MAY restore baseline mapping pairs, and this behavior
SHALL be documented.

#### Scenario: Full replace applied

- GIVEN a role whose tenant-effective stored set is `{A, B}`
- WHEN its tenant permission set is updated to `{B, C}`
- THEN subsequent reads show exactly `{B, C}` for the caller's tenant, while
  other tenants' views remain their own

#### Scenario: Unknown catalog key rejected

- GIVEN an update payload containing a key absent from the seeded catalog
- WHEN the update is submitted
- THEN the response is 400 `VALIDATION_FAILED` and the role's stored
  tenant-effective set is unchanged

#### Scenario: No catalog or role mutation surface

- GIVEN the deployed route inventory
- WHEN enumerated for endpoints creating, editing, or deleting Permission
  catalog entries or Role records
- THEN none exist

### Requirement: Shared retention invariant (effective-holdership)

Every administration command that can change which ACTIVE memberships
effectively hold `users.membership.manage` — tenant permission-set replacement
AND membership role assignment alike — SHALL enforce ONE shared invariant,
expressed ONCE and evaluated INSIDE the command's transaction under the shared
tenant-wide active-membership `SELECT ... FOR UPDATE` lock protocol: after the
commanded write, at least one ACTIVE membership of the tenant MUST hold a role
whose EFFECTIVE permission set (platform baseline merged with that tenant's
override verdicts) contains `users.membership.manage`. Violations SHALL be
rejected with 409 `CONFLICT`, leaving both stored state and the audit log
untouched. Administrator-class SEAT counting SHALL NOT be used as a stranding
predicate: a seat whose role no longer effectively carries the key never
protects a demotion or revocation.

#### Scenario: Last effective manager holder protected

- GIVEN any tenant state
- WHEN either administration command — permission-set replacement through the
  tenant override path or membership role assignment through the assignment path
  — would commit a post-write state in which no active membership's role
  effectively holds `users.membership.manage`
- THEN that command evaluates the SAME unified effective-holdership predicate
  used by the other path, rather than an administrator-class seat count or a
  path-specific approximation
- THEN the response is 409 `CONFLICT`, nothing is written, and no audit row is
  emitted

#### Scenario: Override strip then self-demote composes into protection

- GIVEN a tenant with an OWNER and an ADMIN membership
- WHEN an override replacement first strips `users.membership.manage` from
  ADMIN's tenant-effective set (allowed because the OWNER still holds it), and
  the OWNER then attempts to assign themselves a non-manage-holding role
- THEN the assignment path applies the SAME unified effective-holdership
  predicate as the override path and rejects the second operation with 409
  `CONFLICT` even though an administrator-class seat remains, the membership's
  role is unchanged, and no audit row exists for the rejected attempt

### Requirement: Membership role assignment

The API SHALL expose assignment commands setting the single role of an existing
tenant membership (a membership holds exactly one role; assignment replaces it),
gated by `users.membership.manage` and scoped to the caller's tenant. Targeting
a membership of another tenant SHALL return 404 `NOT_FOUND`. The shared
retention invariant SHALL hold for assignments exactly as it does for
permission-set replacement (see Requirement: Shared retention invariant).

#### Scenario: Assignment changes membership role

- GIVEN a membership currently holding RECEPTIONIST
- WHEN an authorized administrator assigns VETERINARIAN to it
- THEN the membership's role is VETERINARIAN on next read

#### Scenario: Second administrator enables demotion

- GIVEN a tenant with two ADMIN memberships
- WHEN one is assigned a non-administrator role
- THEN the change succeeds and at least one administrator-class membership
  remains

#### Scenario: Cross-tenant target invisible

- GIVEN an authenticated administrator in tenant A
- WHEN any administration command targets a membership or role resource of
  tenant B by UUID
- THEN the response is 404 `NOT_FOUND`, never 403

### Requirement: Audited RBAC mutations

Every RBAC mutation (permission-set update, membership role assignment) SHALL
append exactly one `AuditWriter` row containing the action name, actor id,
target ids, request ID, and — for updates — a before/after diff in metadata.
Read endpoints SHALL NOT emit audit rows.

#### Scenario: Mapping update emits diff audit row

- GIVEN a successful permission-set update
- WHEN the audit log for the request is inspected
- THEN one row exists with actor id, role id, requestId, and metadata holding
  the previous and new key sets

#### Scenario: Assignment emits audit row

- GIVEN a successful membership role reassignment
- WHEN the audit log for the request is inspected
- THEN one row exists with actor id, membership id, and before/after role codes
