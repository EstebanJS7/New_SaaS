---
id: TD-059
type: tech-debt
title: Contact values have no format validation anywhere in the product
status: open
severity: low
owner: product
related_epics:
  - "EPIC-19"
  - "EPIC-04"
related_stories:
  - "IMP-002"
related_decisions:
  - "DEC-073"
created: 2026-10-19
updated: 2026-10-19
---

# TD-059 — No contact format validation

## What was found

While building the customer import's contact handling, the exploration found
that `createCustomerContactBody.value` is `z.string().min(1).max(255)` —
**length only**. There is no e-mail regex and no phone pattern anywhere in the
contact contract, and the repository says so explicitly in
`apps/api/src/suppliers/suppliers.zod.ts`.

So `POST /customers/:customerId/contacts` accepts `"not-an-email"` as an EMAIL
contact today, and the import accepts it for the same reason.

## Why the import did not fix it

[[DEC-073]] and [[IMP-002]] require that a validation rule has exactly ONE home.
Adding a format check inside the import would have made it **stricter than the
endpoint** — a file would fail on a value the API would happily accept, and the
operator would have no way to understand why. The import validates with the
endpoint's rule, which is the whole point of the extraction.

## Why it is ordinary debt rather than a defect

A contact value that is not a valid e-mail is a data-quality problem the
tenant's own operator created, and it fails later at the point of use (a
notification send) rather than corrupting anything. It is the same exposure the
manual entry path already has, so this epic inherits it rather than introducing
it.

## The trigger that would reopen it

A notification failing on an unusable address in real use, a tenant asking why
an imported contact does not work, or [[EPIC-20]] reviewing input validation.

## What a fix would touch

- `packages/customers/src/customer-contact.zod.ts` — the ONE home, which then
  covers the API, the import and anything else that creates a contact.
- The portal's own profile editing, which writes the holder's contact through
  the same contract.
- A decision about how strict a phone number should be for a country whose
  numbers the product has not enumerated.
