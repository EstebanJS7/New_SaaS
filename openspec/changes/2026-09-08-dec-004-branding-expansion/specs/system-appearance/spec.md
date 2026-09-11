# System Appearance Specification

## Purpose

Define the `system` appearance mode and the resolution precedence that avoids a
flash of unstyled content before first paint.

## Requirements

### Requirement: Appearance Options

The appearance selector MUST support `"light"`, `"dark"`, and `"system"`. The
system MUST persist the user's selection in `localStorage`.

#### Scenario: User selects system

- GIVEN a staff user opens the appearance selector
- WHEN they choose `system`
- THEN `localStorage["newsaas.appearance"]` is set to `"system"`

### Requirement: System-Preference Precedence

Effective appearance MUST resolve in this order: explicit local `light`/`dark` >
tenant `defaultAppearance` > OS `prefers-color-scheme` > Core default (`light`).
A local value of `"system"` defers to tenant, then OS, then Core.

#### Scenario: Explicit local dark wins

- GIVEN `localStorage.appearance = "dark"` and tenant
  `defaultAppearance = "light"`
- WHEN the app boots
- THEN the UI renders in dark mode

#### Scenario: Tenant default wins when local is system

- GIVEN `localStorage.appearance = "system"` and tenant
  `defaultAppearance = "dark"`
- WHEN the app boots
- THEN the UI renders in dark mode

#### Scenario: OS preference wins when tenant default is absent

- GIVEN `localStorage.appearance = "system"`, no tenant `defaultAppearance`, and
  the OS prefers dark
- WHEN the app boots
- THEN the UI renders in dark mode

#### Scenario: Core light fallback

- GIVEN `localStorage.appearance = "system"`, no tenant `defaultAppearance`, and
  the OS prefers light
- WHEN the app boots
- THEN the UI renders in light mode

### Requirement: Pre-Paint Bootstrap

The application MUST render a parser-blocking inline bootstrap script before any
paint-affecting node. The script MUST read `localStorage`, compute effective
appearance, and apply the `dark` class to `<html>` before first paint. `<html>`
MUST carry `suppressHydrationWarning`.

#### Scenario: No flash on system dark

- GIVEN a user with `localStorage.appearance = "system"` and OS dark preference
- WHEN the page loads
- THEN the first paint already has the `dark` class applied

### Requirement: Runtime OS Change Handling

When the selected mode is `"system"` and no tenant default overrides, the
application SHOULD react to `prefers-color-scheme` changes without requiring a
page reload.

#### Scenario: OS switches to light

- GIVEN `localStorage.appearance = "system"` and no tenant `defaultAppearance`
- WHEN the OS changes from dark to light
- THEN the UI switches to light mode

### Requirement: Tolerate Storage Failures

If `localStorage` is missing, inaccessible, or contains an invalid value, the
system MUST fall back to tenant `defaultAppearance`, then OS preference, then
Core light, without throwing.

#### Scenario: Corrupt localStorage falls back

- GIVEN `localStorage.appearance = "invalid"`
- WHEN the app boots
- THEN the UI resolves using tenant/OS/Core defaults
