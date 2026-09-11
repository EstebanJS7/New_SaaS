# Branding Asset Lifecycle Specification

## Purpose

Define tenant-owned logo/favicon upload, replacement, delivery, and invalidation
while keeping storage keys opaque and preserving product-preset fallback.

## Requirements

### Requirement: Tenant Isolation

Every `BrandingAsset` MUST belong to exactly one tenant. Asset routes MUST
derive the tenant exclusively from the authenticated server-side request context
and MUST NOT accept a client-supplied tenant identifier. A staff member
authenticated into Tenant A can therefore only read, upload, replace, or remove
Tenant A assets; Tenant B assets are never addressable or observable.

#### Scenario: Same-tenant upload succeeds

- GIVEN an authenticated staff member with `branding.settings.manage` and the
  `custom_branding` entitlement
- WHEN they upload a valid logo for their own tenant
- THEN the API returns `201 Created` and a signed URL for the asset

#### Scenario: Client-supplied tenant id is not authority

- GIVEN an authenticated staff member of Tenant A
- WHEN they include a foreign `tenantId` in the request query, header, or body
- THEN the API ignores it, performs the mutation against Tenant A, and stores no
  asset for the foreign tenant

#### Scenario: Cross-tenant asset is not observable

- GIVEN Tenant A stores a logo and Tenant B has none
- WHEN a staff member of Tenant B reads its own logo
- THEN the API returns `404 NOT_FOUND`, revealing nothing about Tenant A's asset

### Requirement: Authorization and Entitlement

Upload, replacement, and removal of branding assets MUST require both the
`branding.settings.manage` permission and the `custom_branding` entitlement.
Missing either MUST yield `403 FORBIDDEN`.

#### Scenario: Missing entitlement is rejected

- GIVEN an authenticated staff member with `branding.settings.manage` but
  without `custom_branding`
- WHEN they upload a favicon
- THEN the API returns `403 FORBIDDEN`

### Requirement: Asset Validation

The system MUST accept only PNG, WebP, and ICO image types. It MUST verify the
declared MIME type against file content, MUST enforce per-asset size limits
(logo ≤ 2 MB, favicon ≤ 512 KB), and MUST reject executable, SVG, script,
unknown, or content-mismatched files.

#### Scenario: Valid PNG logo accepted

- GIVEN a 1 MB PNG file whose content matches its MIME type
- WHEN an entitled staff member uploads it as `logoLight`
- THEN the system stores the asset and returns a signed URL

#### Scenario: Oversized logo rejected

- GIVEN a 3 MB PNG file
- WHEN an entitled staff member uploads it as `logoLight`
- THEN the API returns `413 Payload Too Large` and no asset is stored

#### Scenario: Disguised executable rejected

- GIVEN a file named `logo.png` whose content is an executable
- WHEN an entitled staff member uploads it
- THEN the API returns `400 Bad Request` and no asset is stored

### Requirement: Opaque Keys and Signed URLs

The system MUST persist only opaque storage keys; it MUST NOT expose bucket
names, paths, or keys in any API response. Asset URLs returned to clients MUST
be short-lived signed URLs.

#### Scenario: Staff receives signed URL, not key

- GIVEN a stored branding asset
- WHEN the staff resolved-brand endpoint returns the asset
- THEN the response contains a signed URL and no storage key or bucket path

### Requirement: Replacement and Cache Invalidation

Replacing or removing a branding asset MUST atomically update the tenant
branding record, invalidate resolved-brand caches, and retire the previous asset
key so that prior signed URLs fail.

#### Scenario: Logo replacement revokes old URL

- GIVEN an existing `logoLight` asset with an active signed URL
- WHEN an entitled staff member uploads a new `logoLight`
- THEN the resolved brand returns the new signed URL and requests to the old
  signed URL return `403` or `404`

### Requirement: Audit

Every successful asset mutation MUST co-commit an `audit_log` row recording the
tenant, actor, action, asset kind, and timestamp in the same database
transaction.

#### Scenario: Successful upload is audited

- GIVEN a valid asset upload request
- WHEN the upload commits
- THEN an `audit_log` row exists with `action=branding.asset.created`

### Requirement: Reset Clears Linked Assets

`POST /branding/reset` MUST delete the tenant branding row and every linked
`BrandingAsset` row in the same transaction, and MUST co-commit a
`branding.reset` audit row recording the prior asset ids, storage keys, and
per-kind presence (`hadAssets`). Reset MUST NOT delete storage objects
in-request. When the reset disconnected at least one object, the same
transaction MUST persist exactly one tenant-scoped `PENDING` cleanup intent
capturing those opaque keys; an empty or repeated reset MUST NOT create an
intent. Because the row cleanup frees the `@@unique([tenantId, kind])` index,
re-uploading the same kind MUST succeed without a `P2002` conflict.

#### Scenario: Reset deletes records and queues durable cleanup

- GIVEN a tenant has uploaded logo and favicon assets
- WHEN an authorized user triggers branding reset
- THEN the transaction deletes all tenant asset rows
- AND the audit row commits atomically with the row cleanup
- AND exactly one `PENDING` cleanup intent captures the removed storage keys
- AND no storage object is deleted in-request

#### Scenario: Reset audits prior asset metadata

- GIVEN a tenant has uploaded at least one branding asset
- WHEN an authorized user triggers branding reset
- THEN the audit row records `hadAssets` per kind together with the prior asset
  ids and storage keys
- AND the audit row includes the actor and timestamp

#### Scenario: Re-upload succeeds after reset

- GIVEN a tenant has reset branding and removed all prior assets
- WHEN an authorized user uploads a new logo of the same kind
- THEN the upload succeeds without a `P2002` conflict

#### Scenario: Empty or repeated reset creates no orphaned intent

- GIVEN a tenant has already reset branding or never configured assets
- WHEN an authorized user triggers branding reset
- THEN the operation succeeds without error
- AND no cleanup intent is created

### Requirement: Durable Reset Storage Retirement

After the reset transaction commits, the system MUST enqueue the intent id with
`jobId = intentId` on the `branding-reset-cleanup` queue. A post-commit enqueue
failure MUST NOT fail the reset response and MUST leave the intent `PENDING` for
reconciliation. The worker MUST load the intent by id (and tenant), delete ONLY
the captured opaque keys through the storage port, and move `PENDING` →
`COMPLETED` through a guarded transition that writes exactly one SYSTEM
`branding.reset.storage_retired` audit. Retries MUST be bounded; on exhaustion
the intent MUST become terminal `DEAD_LETTER` with a sanitized `lastError` and a
SYSTEM `branding.reset.storage_cleanup_failed` audit. A periodic sweep MUST
re-enqueue `PENDING` intents older than a threshold without duplicating
completed work. Failures MUST never be silently swallowed.

#### Scenario: Enqueue failure is recoverable

- GIVEN the reset committed a `PENDING` intent and the post-commit enqueue
  throws
- WHEN the reset response returns success
- THEN the intent remains `PENDING` and the reconciliation sweep reclaims it

#### Scenario: Worker retires captured keys

- GIVEN a committed `PENDING` intent
- WHEN the worker processes it
- THEN only the captured keys are deleted
- AND the intent becomes `COMPLETED` with exactly one SYSTEM retirement audit

#### Scenario: Duplicate processing is idempotent

- GIVEN a `COMPLETED` intent
- WHEN the cleanup job runs again
- THEN no key is re-processed and no duplicate audit is written

#### Scenario: Unknown or cross-tenant intent is a no-op

- GIVEN an intent id that does not exist or belongs to another tenant
- WHEN the worker is asked to process it
- THEN no key is deleted and no intent or audit row is mutated

#### Scenario: Transient failure retries then succeeds

- GIVEN a transient storage failure
- WHEN the worker retries within the bound
- THEN cleanup eventually succeeds with exactly one retirement audit

#### Scenario: Exhausted attempts terminate visibly

- GIVEN storage failures exceed the bound
- WHEN the final attempt fails
- THEN the intent becomes terminal `DEAD_LETTER`
- AND one SYSTEM failure audit with a sanitized error is written
