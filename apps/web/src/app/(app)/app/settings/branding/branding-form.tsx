"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BRAND_OVERRIDE_SCHEMA_VERSION,
  type BrandOverride,
  type DefaultAppearance,
  type ResolvedBrand,
} from "@newsaas/ui/branding";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { BrandingPreview } from "./branding-preview";

interface BrandingResponse {
  readonly source: "tenant" | "preset";
  readonly brand: ResolvedBrand;
}

interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

interface FormState {
  primary: string;
  accent: string;
  radius: string;
  defaultAppearance: DefaultAppearance;
}

const DEFAULT_FORM_STATE: FormState = {
  primary: "",
  accent: "",
  radius: "",
  defaultAppearance: "light",
};

function brandToFormState(brand: ResolvedBrand): FormState {
  return {
    primary: brand.theme.colors.primary,
    accent: brand.theme.colors.accent,
    radius: brand.theme.radius,
    defaultAppearance: brand.defaultAppearance,
  };
}

function formStateToOverrides(state: FormState): BrandOverride {
  const overrides: BrandOverride = {
    schemaVersion: BRAND_OVERRIDE_SCHEMA_VERSION,
  };
  if (state.primary.trim().length > 0) {
    overrides.primary = state.primary.trim();
  }
  if (state.accent.trim().length > 0) {
    overrides.accent = state.accent.trim();
  }
  if (state.radius.trim().length > 0) {
    overrides.radius = state.radius.trim();
  }
  overrides.defaultAppearance = state.defaultAppearance;
  return overrides;
}

async function fetchBranding(): Promise<BrandingResponse> {
  const response = await fetch("/api/branding/current", { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
    throw new Error(body.error?.message ?? `Failed to load branding (${response.status})`);
  }
  return response.json() as Promise<BrandingResponse>;
}

async function saveBranding(overrides: BrandOverride): Promise<BrandingResponse> {
  const response = await fetch("/api/branding/current", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ overrides }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
    throw new Error(body.error?.message ?? `Failed to save branding (${response.status})`);
  }
  return response.json() as Promise<BrandingResponse>;
}

async function resetBranding(): Promise<BrandingResponse> {
  const response = await fetch("/api/branding/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
    throw new Error(body.error?.message ?? `Failed to reset branding (${response.status})`);
  }
  return response.json() as Promise<BrandingResponse>;
}

function userFacingErrorMessage(error: Error): string {
  const message = error.message;
  if (message.includes("Authentication required") || message.includes("UNAUTHENTICATED")) {
    return "You must be signed in to manage branding.";
  }
  if (message.includes("Access denied") || message.includes("FORBIDDEN")) {
    return "You do not have permission to manage branding.";
  }
  if (message.includes("feature is not enabled") || message.includes("FEATURE_NOT_ENTITLED")) {
    return "Custom branding is not enabled for this tenant.";
  }
  return message;
}

/**
 * Staff branding settings form.
 *
 * - Loads the resolved brand via the web proxy.
 * - Edits only the four v1 tokens bound by the approved schema.
 * - Previews changes locally inside a bounded sample card.
 * - Save submits a PUT; Reset submits an idempotent POST to remove overrides.
 * - Loading, empty/default, success, error, and entitlement/unauthorized states
 *   are rendered with existing semantic tokens and components.
 */
export function BrandingForm(): JSX.Element {
  const queryClient = useQueryClient();
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const query = useQuery({
    queryKey: ["branding", "current"],
    queryFn: fetchBranding,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const initialFormState = useMemo<FormState>(() => {
    if (query.data?.brand) {
      return brandToFormState(query.data.brand);
    }
    return DEFAULT_FORM_STATE;
  }, [query.data?.brand]);

  const [formState, setFormState] = useState<FormState>(initialFormState);

  // Keep form state in sync with the fetched brand, but only when the query
  // data changes from an external source (load or mutation), not while the
  // user is typing.
  const [lastSyncedBrand, setLastSyncedBrand] = useState<ResolvedBrand | undefined>(
    query.data?.brand
  );
  if (query.data?.brand && query.data.brand !== lastSyncedBrand) {
    setLastSyncedBrand(query.data.brand);
    setFormState(brandToFormState(query.data.brand));
  }

  const saveMutation = useMutation({
    mutationFn: saveBranding,
    onSuccess: (data) => {
      queryClient.setQueryData(["branding", "current"], data);
      setLastSyncedBrand(data.brand);
      setFormState(brandToFormState(data.brand));
      setSaveSuccess(true);
      setResetSuccess(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: () => {
      setSaveSuccess(false);
    },
  });

  const resetMutation = useMutation({
    mutationFn: resetBranding,
    onSuccess: (data) => {
      queryClient.setQueryData(["branding", "current"], data);
      setLastSyncedBrand(data.brand);
      setFormState(brandToFormState(data.brand));
      setResetSuccess(true);
      setSaveSuccess(false);
      setTimeout(() => setResetSuccess(false), 3000);
    },
    onError: () => {
      setResetSuccess(false);
    },
  });

  const isPending = query.isLoading || saveMutation.isPending || resetMutation.isPending;
  const error = query.error ?? saveMutation.error ?? resetMutation.error;
  const disabled = isPending || query.isLoading;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {userFacingErrorMessage(error)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Brand tokens</CardTitle>
          <CardDescription>
            Customize the visual tokens used by the staff shell. Changes are previewed locally until
            you save.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading branding settings...</div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="primary" className="text-sm font-medium">
                    Primary color
                  </label>
                  <input
                    id="primary"
                    type="text"
                    value={formState.primary}
                    onChange={(event) =>
                      setFormState((previous) => ({ ...previous, primary: event.target.value }))
                    }
                    placeholder="hsl(...) or #rrggbb"
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="accent" className="text-sm font-medium">
                    Accent color
                  </label>
                  <input
                    id="accent"
                    type="text"
                    value={formState.accent}
                    onChange={(event) =>
                      setFormState((previous) => ({ ...previous, accent: event.target.value }))
                    }
                    placeholder="hsl(...) or #rrggbb"
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="radius" className="text-sm font-medium">
                    Radius
                  </label>
                  <input
                    id="radius"
                    type="text"
                    value={formState.radius}
                    onChange={(event) =>
                      setFormState((previous) => ({ ...previous, radius: event.target.value }))
                    }
                    placeholder="0.5rem"
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="defaultAppearance" className="text-sm font-medium">
                    Default appearance
                  </label>
                  <select
                    id="defaultAppearance"
                    value={formState.defaultAppearance}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        defaultAppearance: event.target.value as DefaultAppearance,
                      }))
                    }
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-4">
                <Button
                  type="button"
                  onClick={() => saveMutation.mutate(formStateToOverrides(formState))}
                  disabled={disabled}
                >
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => resetMutation.mutate()}
                  disabled={disabled}
                >
                  {resetMutation.isPending ? "Resetting..." : "Reset to default"}
                </Button>
                {saveSuccess && (
                  <span className="text-sm text-status-success">Branding saved.</span>
                )}
                {resetSuccess && (
                  <span className="text-sm text-status-success">Branding reset to default.</span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!query.isLoading && (
        <BrandingPreview
          primary={formState.primary}
          accent={formState.accent}
          radius={formState.radius}
        />
      )}
    </div>
  );
}
