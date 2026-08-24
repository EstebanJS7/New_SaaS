# Delta for api-contract-security-baseline

## ADDED Requirements

### Requirement: Uniform error envelope

Every error response SHALL return the stable envelope
`{ "error": { "code", "message", "requestId" } }` — including validation
failures, authorization failures, and unhandled exceptions. Production responses
SHALL NOT include stack traces or internal details.

#### Scenario: Validation failure shape

- GIVEN a request failing input validation
- WHEN the API responds 400
- THEN the body matches the envelope with code `VALIDATION_FAILED` and the
  current request ID

#### Scenario: Unhandled exception shape

- GIVEN a route throws an unexpected error in production mode
- WHEN the API responds 500
- THEN the body matches the envelope with a generic internal code and no stack
  trace

### Requirement: Stable domain error code registry

The API SHALL map every error to a stable, centrally registered code with a
defined HTTP status (e.g. `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `RATE_LIMITED`, `INTERNAL`). Existing codes SHALL NOT be renamed or
repurposed between releases; evolution extends the registry.

#### Scenario: Known domain error maps deterministically

- GIVEN a domain error raised by application logic
- WHEN the exception filter handles it
- THEN the response carries the registered code and HTTP status defined in the
  registry

#### Scenario: Registry snapshot stability

- GIVEN the exported error-code registry
- WHEN the contract test suite runs
- THEN previously registered codes and status mappings are unchanged

### Requirement: Request ID propagation and sanitized logs

Every request SHALL carry a request ID — taken from a trusted inbound header
when present, generated otherwise — returned in a response header, bound to
every structured log line for that request, and embedded in error envelopes.
Logs SHALL NEVER contain RESTRICTED material (passwords, hashes, tokens,
secrets) or CONFIDENTIAL payload dumps.

#### Scenario: Inbound request ID honored end to end

- GIVEN a request carrying a request-ID header
- WHEN any response is produced
- THEN the same ID appears in the response header and in any error envelope

#### Scenario: Credentials never logged

- GIVEN a login request executes, successfully or not
- WHEN structured log lines for that request are inspected
- THEN no password or password-hash value appears

### Requirement: Health and readiness probes

The API SHALL expose `/health/live` (process is up) and `/health/ready`
aggregating database and Redis reachability. `/health/ready` SHALL report 503
while any checked dependency is unreachable.

#### Scenario: Dependencies healthy

- GIVEN PostgreSQL and Redis are reachable
- WHEN GET /health/ready is called
- THEN the response is 200

#### Scenario: Dependency down

- GIVEN Redis is unreachable
- WHEN /health/ready and /health/live are called
- THEN ready responds 503 while live still responds 200

### Requirement: Baseline transport security

All `Set-Cookie` responses SHALL be `HttpOnly`, SHALL carry a `SameSite` policy
of Lax or stricter, and SHALL be `Secure` outside local development. Login SHALL
be rate limited; exceeding the limit returns 429 with envelope code
`RATE_LIMITED`. CORS origins and security headers SHALL be configured
server-side by default.

#### Scenario: Login rate limited

- GIVEN the configured attempt threshold is exceeded for one identity/source
- WHEN further login attempts arrive
- THEN each responds 429 with envelope code `RATE_LIMITED`

#### Scenario: Cookie flags enforced

- GIVEN the API sets any cookie
- WHEN the Set-Cookie header is inspected
- THEN it is HttpOnly, SameSite Lax-or-stricter, and Secure in non-development
  environments
