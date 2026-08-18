"use client";

import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * Fetches the API liveness endpoint through the web app's health route.
 *
 * In the browser the request is same-origin to `/api/health/live`, which the
 * web route proxies to `NEXT_PUBLIC_API_URL/health/live`. This avoids a broad
 * CORS opening on the API for a development-only concern.
 */
async function fetchLive(): Promise<{ status: string }> {
  const response = await fetch("/api/health/live", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`API health check failed: ${response.status}`);
  }

  return response.json() as Promise<{ status: string }>;
}

/**
 * Polls the API liveness endpoint and renders availability.
 *
 * No Veterinary-specific branding or copy is used.
 */
export function HealthIndicator(): JSX.Element {
  const { data, isError, isPending } = useQuery({
    queryKey: ["api-health"],
    queryFn: fetchLive,
    refetchInterval: 5_000,
    retry: false,
  });

  const available = !isError && !isPending && data?.status === "healthy";

  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2"
      data-testid="health-indicator"
      data-status={available ? "available" : "unavailable"}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="text-sm font-medium">{available ? "API available" : "API unavailable"}</span>
    </div>
  );
}
