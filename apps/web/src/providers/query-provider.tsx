"use client";

import { useState, type JSX, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StaffSessionBoundary } from "./staff-session-boundary";

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * Provides the TanStack Query client to the React tree.
 *
 * Required by <HealthIndicator/> and any future data-fetching components.
 */
export function QueryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(createClient);
  return (
    <QueryClientProvider client={queryClient}>
      <StaffSessionBoundary>{children}</StaffSessionBoundary>
    </QueryClientProvider>
  );
}
