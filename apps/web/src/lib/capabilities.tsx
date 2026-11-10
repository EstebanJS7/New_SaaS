"use client";

import { createContext, useContext, type JSX, type ReactNode } from "react";

/**
 * The caller's capabilities as the staff shell knows them ([[UX-037]]).
 *
 * `undefined` means UNKNOWN (the load failed or no shell supplied them), never
 * "nothing granted": every consumer shows the action and the API stays the
 * authority. An empty list is a KNOWN empty set and hides gated actions.
 */
export interface Capabilities {
  readonly permissions?: readonly string[];
  readonly features?: readonly string[];
}

const UNKNOWN: Capabilities = {};

const CapabilitiesContext = createContext<Capabilities>(UNKNOWN);

/** Shares the capabilities the staff layout loaded once for this request. */
export function CapabilitiesProvider({
  value,
  children,
}: {
  value: Capabilities;
  children: ReactNode;
}): JSX.Element {
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

/** The shell's capabilities; unknown outside a provider. UX only. */
export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}

/** True when the permission is granted, or while permissions are unknown. */
export function hasPermission(capabilities: Capabilities, permission: string): boolean {
  return capabilities.permissions === undefined || capabilities.permissions.includes(permission);
}

/** True when the clinic has the feature, or while features are unknown. */
export function hasFeature(capabilities: Capabilities, feature: string): boolean {
  return capabilities.features === undefined || capabilities.features.includes(feature);
}

/** What an action needs: every listed permission and, optionally, a feature. */
export interface CapabilityRequirement {
  readonly permission?: string | readonly string[];
  readonly feature?: string;
}

/** The one rule every staff screen uses to offer or hide an action ([[UX-037]]). */
export function canUse(capabilities: Capabilities, requirement: CapabilityRequirement): boolean {
  const permissions =
    requirement.permission === undefined
      ? []
      : typeof requirement.permission === "string"
        ? [requirement.permission]
        : requirement.permission;
  if (!permissions.every((permission) => hasPermission(capabilities, permission))) return false;
  return requirement.feature === undefined || hasFeature(capabilities, requirement.feature);
}

/** {@link canUse} against the shell's capabilities. */
export function useCan(requirement: CapabilityRequirement): boolean {
  return canUse(useCapabilities(), requirement);
}
