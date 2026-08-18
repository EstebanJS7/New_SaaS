---
type: fiscal-reference
status: planning
country: PY
updated: 2026-08-13
---

# SIFEN

## Architectural rule

SIFEN is behind the reusable Fiscal provider boundary.

MVP implementation sequence:

```text
FakeFiscalProvider
→ ThirdPartyFiscalProvider
→ SifenDirectFiscalProvider (future)
```

Billing must never call a concrete provider directly.

## Before SIFEN Direct

The implementation task must explicitly verify the current official DNIT
technical baseline at that time:

- Manual Técnico;
- XSDs;
- XML structures;
- Notas Técnicas;
- Web Service requirements;
- signatures/certificates;
- test/certification guide.

Do not copy protocol details from stale notes in this vault.

## Internal lifecycle

Use internal states capable of representing asynchronous processing:

```text
PENDING
QUEUED
SIGNING
SENDING
SUBMITTED
APPROVED
REJECTED
ERROR
CANCEL_PENDING
CANCELLED
```

## Requirements

- queue external submissions;
- idempotent issue requests;
- bounded retry for transient failures;
- preserve provider external ID;
- store XML/KuDE references privately;
- sanitize request/response snapshots;
- audit fiscal configuration and manual retries/cancellations.

## Tenant credentials

Fiscal credentials/certificates are tenant-specific references to a secure
secret store.

Never persist private secret material in plaintext.
