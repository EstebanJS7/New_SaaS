# Delta for identity-staff-auth

## ADDED Requirements

### Requirement: Argon2id credential storage

Staff passwords SHALL be hashed with Argon2id before persistence. Password
hashes are RESTRICTED-classified data: they SHALL never appear in API responses,
DTOs, or logs, and SHALL never leave the credentials store.

#### Scenario: Hashed at rest

- GIVEN a staff user's credentials are created via ops/seed
- WHEN the stored credential record is inspected
- THEN it contains an Argon2id hash and no plaintext password

#### Scenario: No credential material in responses

- GIVEN successful or failed authentication
- WHEN any API response or log line is produced
- THEN neither the password nor its hash appears

### Requirement: Email and password login with PG-backed sessions

The API SHALL authenticate staff by email + password and issue a server-side
session persisted in PostgreSQL, referenced by an opaque session cookie. Invalid
credentials SHALL produce the uniform error envelope with a stable
unauthenticated code and SHALL NOT reveal whether the email exists.

#### Scenario: Successful login establishes a session

- GIVEN valid staff credentials
- WHEN the login endpoint completes
- THEN a session row exists server-side and a session cookie is set

#### Scenario: Invalid credentials rejected uniformly

- GIVEN a wrong password for an existing account
- WHEN login is attempted
- THEN the response is 401 with the error envelope and no session is created

### Requirement: Session cookie semantics and logout revocation

The session cookie SHALL satisfy the transport security baseline (HttpOnly,
SameSite, Secure outside development). Logout SHALL revoke the server-side
session immediately; replaying a revoked cookie SHALL fail authentication.

#### Scenario: Logout revokes server-side session

- GIVEN an authenticated staff session with a captured cookie
- WHEN logout completes and the cookie is replayed
- THEN the replayed request is rejected 401 with the error envelope

#### Scenario: Cookie hardening on session issue

- GIVEN a login that sets the session cookie
- WHEN the Set-Cookie header is inspected
- THEN it satisfies the baseline flags

### Requirement: Authentication guard and RequestContext

Private routes SHALL reject unauthenticated requests with the error envelope
before reaching handlers. Authenticated requests SHALL expose a server-derived
request context (request ID, user identity, tenant/role claims from session
membership); handlers SHALL NOT read identity from client-supplied fields.

#### Scenario: Unauthenticated access blocked

- GIVEN a private route called without a valid session cookie
- WHEN the request arrives
- THEN it is rejected 401 with the error envelope before reaching the handler

#### Scenario: Context derived server-side only

- GIVEN a valid staff session
- WHEN the request reaches a context probe handler
- THEN the context reflects the session's user and membership, ignoring
  client-sent identity fields

### Requirement: Password recovery explicitly deferred

This epic SHALL NOT expose password reset or forgot-password flows. The deferral
SHALL be recorded as a Tech Debt item (blocked on email delivery), never
silently omitted.

#### Scenario: Recovery endpoints absent

- GIVEN the deployed API
- WHEN any password-recovery route is requested
- THEN no such route exists (404 envelope) and the Tech Debt record documents
  the gap
