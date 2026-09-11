# Portal Brand Resolution Specification

## Purpose

Define how the customer portal consumes the safe, public resolved-brand contract
without accessing staff sessions, private configuration, or storage keys.

## Requirements

### Requirement: Public Allowlisted DTO

`GET /api/v1/public/tenants/:slug/branding` MUST return only the PUBLIC
allowlist: `productDisplayName`, `displayName`, `logoLightUrl`, `logoDarkUrl`,
`faviconUrl`, and safe theme tokens. It MUST NOT include storage keys, tenant
IDs, audit metadata, membership data, RUC, billing secrets, or staff
configuration.

#### Scenario: Public DTO for known tenant

- GIVEN a tenant slug with active custom branding
- WHEN an unauthenticated portal client calls the public branding endpoint
- THEN it receives `200 OK` with signed asset URLs and theme tokens only

#### Scenario: Public DTO contains no private fields

- GIVEN a public branding response
- WHEN the body is inspected
- THEN it contains no `assetKey`, `bucket`, `tenantId`, `updatedBy`, `audit*`,
  or `membership*` fields

### Requirement: Tenant Scope by Slug

The endpoint MUST resolve the tenant from the slug. Unknown or inactive slugs
MUST return `404 NOT_FOUND`.

#### Scenario: Unknown slug returns 404

- GIVEN a slug that does not exist
- WHEN the public branding endpoint is called
- THEN it returns `404 NOT_FOUND`

### Requirement: Portal/Staff Authorization Separation

Portal brand consumption MUST use the public endpoint and MUST NOT forward staff
cookies or call private staff branding endpoints. Staff endpoints MUST require
an authenticated staff session.

#### Scenario: Portal without staff cookie succeeds

- GIVEN a portal request with no staff session cookie
- WHEN it calls the public branding endpoint
- THEN it receives the public DTO

#### Scenario: Portal cannot access staff endpoint

- GIVEN an unauthenticated portal request
- WHEN it calls `GET /branding/current`
- THEN it receives `401 UNAUTHORIZED`

### Requirement: Consistent Resolved Identity

For the same tenant, the portal and staff applications MUST render the same
product display name, logo/favicon assets, and theme tokens (excluding
non-public fields).

#### Scenario: Staff and portal share identity

- GIVEN a tenant with a custom logo and primary color
- WHEN the staff layout and the portal layout both resolve the brand
- THEN both render the same logo URL and primary token

### Requirement: Cache Invalidation

Resolved public-brand caching MUST include tenant and theme revision in the
cache key. The cache MUST be invalidated when the tenant branding record or any
referenced asset changes.

#### Scenario: Asset update clears public cache

- GIVEN a public brand cached for Tenant A
- WHEN an entitled staff member replaces the tenant logo
- THEN the next public request for Tenant A returns the new signed URL
