## Exploration: Foundation Readiness for EPIC-00

### Current State

The repository is a **documentation-first baseline** with no application code.
The PRD v1.3 is marked `approved-baseline` and the architecture is frozen. The
`docs/` directory is structured as an Obsidian Vault candidate but is missing
its vault configuration.

**Active Epic / Story status:**

- **EPIC-00 — Foundation** — `status: ready`, `priority: critical`, no
  dependencies. Acceptance criteria listed (16 items) but no `FOUND-*` Story
  files exist yet. The Epic itself is not yet `in-progress`.
- **EPIC-03 — Staff Shell / Design System / Branding** — `status: planned`,
  depends on EPIC-01.
- **BRAND-001 — Semantic design tokens** — `status: planned`, the only Story
  file on disk.
- No Story is `in-progress`. No Foundation Story (`FOUND-001` ... `FOUND-006`)
  exists.

**Documentation completeness:**

- PRD v1.3 (1267 lines, 44 sections) — covers product, architecture, stack,
  multi-tenancy, RBAC, branding, reversals, internal events, data
  classification, demo tenant, complexity budget.
- Architecture docs: `OVERVIEW`, `BRANDING-THEMING`, `TENANT-SETTINGS`,
  `INTERNAL-EVENTS`, `REVERSALS-CORRECTIONS`, `DATA-CLASSIFICATION-RETENTION`,
  `DEMO-TENANT`.
- ADRs accepted: `ADR-001 Modular Monolith`, `ADR-002 Branding Theme Layering`,
  `ADR-003 Minimal Internal Application Events`.
- Module docs: `Branding.md` and `Tenant-Settings.md` (both `status: planned`).
  The README lists 12 expected modules; only 2 are present, which is acceptable
  for a pre-implementation repo.
- Templates: `STORY`, `EPIC`, `ADR`, `DECISION`, `BUG`, `TECH-DEBT`, `MODULE`,
  `RELEASE` — all eight present and complete.
- Governance: `ENGINEERING-RULES.md`, `DOCUMENTATION-RULES.md`, `WORKFLOW.md` —
  present and aligned with the PRD.

**OpenSpec state:**

- `openspec/config.yaml` — present, declares repo as documentation-only
  baseline, all `testing.*` `available: false`. This is consistent with the
  actual state.
- `openspec/specs/` — empty (only `.gitkeep`).
- `openspec/changes/` — empty.
- `openspec/changes/archive/` — empty.

The project stores its authoritative specs in `docs/`, not in `openspec/specs/`.
`openspec/config.yaml` does not reconcile this. The SDD pipeline phase-skills
expect writes under `openspec/changes/{change-name}/`. This is workable as long
as the orchestrator treats `docs/` as the user-facing source-of-truth and
`openspec/changes/` as the SDD workflow scratchpad.

**Tooling / config:**

- `AGENTS.md` — present, aligned with PRD.
- `opencode.json` — present, lists both governance docs as `instructions`,
  defines allowed bash patterns for `pnpm lint/typecheck/test/build` and
  `git status/diff/log`.
- `.opencode/commands/` — `story-start`, `story-finish`, `verify`, `decision`,
  `docs-sync` all present.
- `.opencode/agents/` — `architecture-reviewer`, `docs-maintainer`,
  `security-reviewer` all present.
- `.opencode/package.json` — only declares `@opencode-ai/plugin`. The repo
  explicitly gitignores `node_modules`, `package.json`, `package-lock.json`,
  `bun.lock` and `.gitignore` inside `.opencode/`. This is intentional so the
  workspace plugin can be added without polluting the app tree.
- **No git repository** at the project root. `git status` reports "Not a git
  repo". This is a prerequisite for the WORKFLOW model which assumes "Git is the
  source-of-truth technical layer."
- **No `.gitignore`** at the project root.
- **No `.obsidian/` directory** at either the project root or `docs/`. The
  `docs/README.md` states "Open this `docs/` directory directly as an Obsidian
  Vault" but no Obsidian settings are committed.

### Affected Areas

- `docs/README.md` — claims the docs/ folder is a usable Obsidian Vault; the
  claim is technically true (Obsidian will open any folder), but the documented
  "Template folder = `_templates`" recommendation is not persisted in any
  committed config.
- `openspec/config.yaml` — declares `testing.*` as unavailable; this will need
  to be updated when EPIC-00 ships the test runner / linter / typechecker /
  build / formatter.
- `openspec/specs/` — empty. The SDD pipeline expects change deltas to feed
  `openspec/specs/{domain}/spec.md`. The repo's authoritative specs live in
  `docs/`. The orchestrator must decide — before the first SDD change lands —
  whether to either (a) let `docs/` remain the source-of-truth and write SDD
  deltas as a workflow shadow, or (b) treat `openspec/specs/` as authoritative
  and migrate `docs/`.
- `openspec/changes/` — empty. No active change.
- `docs/01-roadmap/EPIC-00-Foundation.md` — references `FOUND-001` ...
  `FOUND-006` as example Stories in a "to be created" section. These are not yet
  created.
- `docs/02-stories/BRAND-001-semantic-design-tokens.md` — the only Story file.
  Not in EPIC-00 scope.
- `docs/09-releases/CHANGELOG.md` — `Unreleased` section lists the architecture
  freeze items but does not yet list a planned EPIC-00 entry.
- Project root — no `.gitignore`, no git repo. EPIC-00's first acceptance
  criterion is `pnpm install` from a clean checkout, which itself requires an
  init.

### Approaches

1. **Bootstrap-and-go** — Initialize git, create a root `.gitignore`, commit the
   documentation baseline as the first commit, then immediately spawn
   `FOUND-001` (workspace bootstrap) as the first Story.
   - Pros: smallest cooldown to start; respects existing workflow; the
     `.opencode/.gitignore` already shows the team's intent for OpenCode plugin
     isolation.
   - Cons: skips the Obsidian vault config and the openspec-spec location
     question.
   - Effort: Low.

2. **Harden the vault first, then bootstrap** — Before any code: (a) commit a
   minimal `.obsidian/app.json` with the template folder, (b) add a root
   `.gitignore`, (c) init git, (d) make a documentation-baseline commit, (e)
   only then start `FOUND-001`.
   - Pros: the docs/ folder becomes a true Obsidian Vault out of the box,
     matching the documented intent; the audit history starts clean.
   - Cons: adds 1–2 hours before EPIC-00 can begin.
   - Effort: Low.

3. **Resolve the openspec-vs-docs conflict first, then bootstrap** — Before any
   code: decide whether authoritative specs live in `docs/` or
   `openspec/specs/`, migrate if needed, then bootstrap.
   - Pros: avoids future rework of SDD artifacts.
   - Cons: this is a scope and governance question that should not be silently
     resolved by an agent. Belongs in a Decision proposal.
   - Effort: Medium (requires a Decision and, if docs migration is chosen, a
     non-trivial move).

### Recommendation

Go with **Approach 2** (harden the vault first). The fixes are small,
mechanical, and clearly within the agent's authority:

1. Create a root `.gitignore` that mirrors the `.opencode/.gitignore` pattern at
   the project level (ignore `node_modules`, `bun.lock`, OS files, editor files,
   secret files) and explicitly **does not** ignore `.obsidian/`.
2. Initialize a git repo with `git init` and commit the documentation baseline
   as the first commit. Do not push — that requires explicit user instruction.
3. Add a minimal `.obsidian/app.json` (and optionally
   `.obsidian/appearance.json`) committing the `_templates` folder so the
   documented "Template folder = `_templates`" recommendation is actually
   persisted.
4. Then trigger `/story-start EPIC-00` flow, which will create the first
   Foundation Story (`FOUND-001 Workspace Bootstrap`) from the template.

**Why not approach 3 now:** The `docs/` vs `openspec/specs/` question is a real
architectural question that affects every future change. It should become a
Decision proposal (or a future ADR if it crosses the Complexity Budget) — not a
silent fix. The bridged reality is workable: SDD phase artifacts can live under
`openspec/changes/{change-name}/` as the workflow shadow, while `docs/` remains
the human-facing source-of-truth. The orchestrator should make this explicit in
the first change's `proposal.md`.

**Why not approach 1:** A documentation-first repo that claims to be an Obsidian
Vault should actually be one. The `.obsidian/` and `.gitignore` adds are tiny,
reversible, and aligned with what `docs/README.md` already promises.

### Risks

- **No git repo** — Until git is initialized, the workflow cannot complete a
  commit/version step. WORKFLOW §8 and §9 assume git is the recovery layer.
- **Missing `.obsidian/`** — Authors opening this repo in Obsidian will see
  `[[...]]` links work but Templates won't auto-resolve until they manually set
  the folder. This is a low-severity UX gap, not a blocker.
- **`openspec/specs/` and `docs/` dual location** — If the orchestrator later
  treats `openspec/` as authoritative, the first SDD change will need a
  migration. Should be raised as a Decision before EPIC-01, not before EPIC-00.
- **EPIC-00 has no Story files** — The `/story-start` command expects a Story
  (not an Epic) to operate. The Epic file itself lists `FOUND-001` ...
  `FOUND-006` as examples, not as committed Stories. The agent must create them
  from the template before any work can begin.
- **`opencode.json` whitelists `pnpm` only** — The repo currently has no
  `package.json` at the root. EPIC-00 will introduce pnpm. The whitelist is
  already correct; just note that the first `pnpm install` will need to be run
  by the user (or the agent under the `ask` permission).
- **Repository is not under Git** — Cannot detect prior commit history or
  remote. Push requires explicit user instruction.

### Ready for Proposal

**Yes, with one small hardening slice first.**

The documentation baseline is sufficient to start EPIC-00. The PRD, ADRs,
architecture docs, templates, governance, commands, and opencode.json are all in
place. The only required pre-work is the small "make this a real vault" slice
(root `.gitignore`, git init, minimal `.obsidian/app.json` with `_templates` as
the template folder). Once that lands, the next move is `/story-start EPIC-00`
which will create `FOUND-001 Workspace Bootstrap` as the first implementable
Story.

The orchestrator should tell the user:

> The repository is documentation-ready. EPIC-00 (Foundation) is marked `ready`
> and has no blockers. Before implementation, three small artifacts are missing:
> a root `.gitignore`, a git init, and a minimal `.obsidian/app.json` committing
> the `_templates` folder. With those in place, the recommended first slice is
> `FOUND-001` (workspace bootstrap). The `docs/` vs `openspec/specs/`
> source-of-truth question is a separate Decision that should be raised before
> EPIC-01, not now.
