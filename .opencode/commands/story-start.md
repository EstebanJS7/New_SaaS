---
description: Start an Epic or Story using the repository workflow
---

Start work on `$1`.

Mandatory sequence:

1. Read `AGENTS.md`.
2. Read the governance rules relevant to this task.
3. Locate the Epic or Story with ID `$1` under `docs/01-roadmap/` or
   `docs/02-stories/`.
4. If it does not exist, do not invent product scope. Report that the work item
   is missing and propose the smallest appropriate Story file based on the
   approved PRD.
5. Read the work item's linked PRD sections, ADRs, Decisions, dependencies and
   module docs.
6. Inspect git status and relevant existing code.
7. Check whether dependencies are satisfied.
8. Update the work item's frontmatter to `status: in-progress` and today's
   `updated` date only when work can actually begin.
9. Do not alter acceptance criteria unless there is explicit approved scope
   change.
10. Check the Complexity Budget in `AGENTS.md`. If the planned work would cross
    an architecture-freeze boundary, create/propose an ADR before implementing
    that structural change.
11. Produce a concise implementation plan tied directly to acceptance criteria.
12. Implement only this work item. Do not opportunistically implement future
    Epics.
13. Keep its documentation current while working.

If architecture or approved scope is unclear, create a proposed Decision rather
than silently redesigning the product.
