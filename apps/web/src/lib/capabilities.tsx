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
