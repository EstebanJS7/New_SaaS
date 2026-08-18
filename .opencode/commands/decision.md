---
description:
  Create a decision proposal instead of silently changing approved scope
---

A new decision is needed: `$ARGUMENTS`.

1. Read the relevant PRD/Story/ADR context.
2. Determine whether this is:
   - an architectural decision → ADR; or
   - a product/implementation choice → Decision.
3. Find the next unused ID in the corresponding directory.
4. Copy the appropriate template.
5. Create it with `status: proposed`.
6. Document:
   - context;
   - question;
   - options;
   - recommendation;
   - product/architecture/database/API/delivery impact;
   - whether PRD changes are required.
7. Do not mark it accepted unless the user has explicitly made/approved the
   decision.
8. Do not silently implement the broader scope while the decision is unresolved.
