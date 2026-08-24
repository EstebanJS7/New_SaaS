# Delta for staff-shell

Purpose: application chrome for the authenticated area (`/app` route group)
built from shadcn/ui primitives consuming semantic tokens only. Phase A:
chrome-only, no auth wiring, no business domains.

## ADDED Requirements

### Requirement: Shell skeleton renders navigation chrome

The web app MUST render a staff shell — sidebar and topbar wrapping a content
region — under the `/app` route group, composed from shadcn/ui primitives styled
exclusively with semantic tokens. Deep links into `/app` sub-routes MUST render
within the same shell layout.

#### Scenario: Shell wraps content on direct visit

- GIVEN the web app running without prior client-side navigation
- WHEN a user opens `/app`
- THEN sidebar and topbar render around the content region using shadcn/ui
  primitives
- AND all chrome styling resolves through semantic CSS variables

#### Scenario: Sub-route keeps the shell

- GIVEN a nested route under `/app`
- WHEN the user deep-links directly to it
- THEN the same shell layout surrounds the child content

### Requirement: Chrome-only placeholder navigation

Phase A navigation entries MUST be placeholders. The shell MUST NOT ship
business-domain pages, data fetching, or features behind nav entries; real
destinations belong to later epics.

#### Scenario: Nav entries carry no hidden features

- GIVEN the rendered sidebar and topbar
- WHEN their navigation entries are inspected
- THEN each entry is an inert, labeled placeholder
- AND no route under `/app` implements a business domain

### Requirement: Appearance switch

The shell MUST provide a light/dark appearance control that toggles the `dark`
class on the document root without a page reload. The chosen appearance MUST
persist client-side in `localStorage` (explicitly acceptable Phase A
persistence) and be re-applied on subsequent visits; with no stored value the
shell defaults to light.

#### Scenario: Toggle flips theme without reload

- GIVEN the shell rendered in light appearance
- WHEN the user activates the appearance control
- THEN the root element gains class `dark` and rendered token values switch to
  the dark set
- AND no navigation or page reload occurs

#### Scenario: Choice persists across visits

- GIVEN a previously stored dark preference in `localStorage`
- WHEN the shell mounts in a fresh session
- THEN the dark appearance is applied client-side from the stored preference
- AND with no stored entry the shell mounts light

### Requirement: Bounded sample-card content region

The shell MUST expose a bounded main-content region designed to host
self-contained preview cards (the future live-preview sample host). Content
rendered there MUST inherit the shell's resolved tokens so sample cards re-theme
with appearance changes.

#### Scenario: Region hosts and re-themes sample content

- GIVEN the shell with its bounded content region
- WHEN a sample card is rendered inside the region
- THEN it renders within the region using inherited tokens only
- AND toggling appearance re-themes the card without component changes
