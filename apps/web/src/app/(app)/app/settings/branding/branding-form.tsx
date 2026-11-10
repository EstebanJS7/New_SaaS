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
import { useCan, type CapabilityRequirement } from "@/lib/capabilities";

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
    // Resolved brand exposes the tenant layer only; the form shows Core light
    // when the tenant has not chosen an appearance.
    defaultAppearance: brand.defaultAppearance ?? "light",
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

/**
 * A refused branding request, carrying the API's stable error code. Anything
 * else thrown by a fetcher is a request that never reached the server.
 */
class BrandingRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "BrandingRequestError";
    this.code = code;
    this.status = status;
  }
}

async function parseBrandingError(response: Response): Promise<BrandingRequestError> {
  const body = (await response.json().catch(() => ({}))) as Partial<ApiErrorEnvelope>;
  return new BrandingRequestError(
    body.error?.code ?? "UNKNOWN",
    body.error?.message ?? `HTTP ${response.status}`,
    response.status
  );
}

async function fetchBranding(): Promise<BrandingResponse> {
  const response = await fetch("/api/branding/current", { cache: "no-store" });
  if (!response.ok) {
    throw await parseBrandingError(response);
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
    throw await parseBrandingError(response);
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
    throw await parseBrandingError(response);
  }
  return response.json() as Promise<BrandingResponse>;
}

type AssetKind = "logoLight" | "logoDark" | "favicon";

const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  logoLight: "Logo claro",
  logoDark: "Logo oscuro",
  favicon: "Favicon",
};

const ASSET_KIND_ACCEPT = "image/png,image/webp,image/x-icon,image/vnd.microsoft.icon";

interface AssetUploadResult {
  readonly kind: AssetKind;
  readonly contentType: string;
  readonly byteSize: number;
  readonly url: string;
}

async function uploadAsset(kind: AssetKind, file: File): Promise<AssetUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`/api/branding/assets/${kind}`, {
    method: "POST",
    body: formData,
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseBrandingError(response);
  }
  return response.json() as Promise<AssetUploadResult>;
}

async function removeAsset(kind: AssetKind): Promise<{ kind: AssetKind; removed: boolean }> {
  const response = await fetch(`/api/branding/assets/${kind}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseBrandingError(response);
  }
  return response.json() as Promise<{ kind: AssetKind; removed: boolean }>;
}

/** The sentence a failed branding request shows; never the API's English text. */
function userFacingErrorMessage(error: Error): string {
  if (!(error instanceof BrandingRequestError)) {
    return "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar.";
  }
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "Iniciá sesión para gestionar la marca.";
    case "FORBIDDEN":
      return "No tenés permiso para gestionar la marca.";
    case "FEATURE_NOT_ENTITLED":
      return "La marca personalizada no está habilitada para esta organización.";
    case "BRAND_OVERRIDE_INVALID_VALUE":
    case "BRAND_OVERRIDE_UNKNOWN_KEY":
    case "BRAND_OVERRIDE_UNSUPPORTED_SCHEMA_VERSION":
      return "Revisá los valores de la marca: alguno no tiene un formato válido.";
    case "PAYLOAD_TOO_LARGE":
      return "El archivo supera el tamaño permitido: hasta 2 MB para los logos y 512 KB para el favicon.";
    case "VALIDATION_FAILED":
      return "Revisá los datos: los archivos deben ser PNG, WebP o ICO y los valores, válidos.";
    default:
      return "No pudimos completar la operación de marca. Volvé a intentar.";
  }
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
/**
 * What a branding write needs ([[UX-037]]): `apps/api/src/branding/branding.controller.ts`
 * and `branding-asset.controller.ts` require `branding.settings.manage`, and
 * `branding.service.ts` / `branding-asset.service.ts` re-check the
 * `custom_branding` entitlement. Reading the current brand needs neither.
 */
export const BRANDING_ACTIONS = {
  manage: { permission: "branding.settings.manage", feature: "custom_branding" },
} as const satisfies Record<string, CapabilityRequirement>;

export function BrandingForm(): JSX.Element {
  const queryClient = useQueryClient();
  // UX-037: without the write capability the brand stays visible, read-only.
  const canManage = useCan(BRANDING_ACTIONS.manage);
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

  const [selectedFiles, setSelectedFiles] = useState<Record<AssetKind, File | null>>({
    logoLight: null,
    logoDark: null,
    favicon: null,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ kind, file }: { kind: AssetKind; file: File }) => uploadAsset(kind, file),
    onSuccess: (_, variables) => {
      setSelectedFiles((previous) => ({ ...previous, [variables.kind]: null }));
      void queryClient.invalidateQueries({ queryKey: ["branding", "current"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (kind: AssetKind) => removeAsset(kind),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["branding", "current"] });
    },
  });

  const isPending =
    query.isLoading ||
    saveMutation.isPending ||
    resetMutation.isPending ||
    uploadMutation.isPending ||
    removeMutation.isPending;
  const error =
    query.error ??
    saveMutation.error ??
    resetMutation.error ??
    uploadMutation.error ??
    removeMutation.error;
  const disabled = isPending || query.isLoading || !canManage;

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
          <CardTitle>Apariencia de la marca</CardTitle>
          <CardDescription>
            Personalizá los colores y la forma que usa la interfaz del personal. Los cambios se ven
            en la vista previa hasta que guardás.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <div className="text-sm text-muted-foreground">
              Cargando la configuración de marca...
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="primary" className="text-sm font-medium">
                    Color primario
                  </label>
                  <input
                    id="primary"
                    type="text"
                    value={formState.primary}
                    onChange={(event) =>
                      setFormState((previous) => ({ ...previous, primary: event.target.value }))
                    }
                    placeholder="hsl(...) o #rrggbb"
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="accent" className="text-sm font-medium">
                    Color de acento
                  </label>
                  <input
                    id="accent"
                    type="text"
                    value={formState.accent}
                    onChange={(event) =>
                      setFormState((previous) => ({ ...previous, accent: event.target.value }))
                    }
                    placeholder="hsl(...) o #rrggbb"
                    disabled={disabled}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="radius" className="text-sm font-medium">
                    Radio de bordes
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
                    Apariencia predeterminada
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
                    <option value="light">Clara</option>
                    <option value="dark">Oscura</option>
                    <option value="system">Según el sistema</option>
                  </select>
                </div>
              </div>

              {!canManage && (
                <p className="pt-4 text-sm text-muted-foreground">
                  No tenés permiso para cambiar la marca. Se muestra en solo lectura.
                </p>
              )}
              {canManage && (
                <div className="flex flex-wrap items-center gap-3 pt-4">
                  <Button
                    type="button"
                    onClick={() => saveMutation.mutate(formStateToOverrides(formState))}
                    disabled={disabled}
                  >
                    {saveMutation.isPending ? "Guardando..." : "Guardar"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => resetMutation.mutate()}
                    disabled={disabled}
                  >
                    {resetMutation.isPending
                      ? "Restableciendo..."
                      : "Restablecer valores predeterminados"}
                  </Button>
                  {saveSuccess && (
                    <span className="text-sm text-status-success">Marca guardada.</span>
                  )}
                  {resetSuccess && (
                    <span className="text-sm text-status-success">
                      Marca restablecida a los valores predeterminados.
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Recursos de identidad</CardTitle>
            <CardDescription>
              Subí los logos y un favicon. Los archivos deben ser PNG, WebP o ICO. Los logos pueden
              pesar hasta 2 MB y el favicon, hasta 512 KB.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {query.isLoading ? (
              <div className="text-sm text-muted-foreground">
                Cargando los recursos de identidad...
              </div>
            ) : (
              <>
                {(["logoLight", "logoDark", "favicon"] as AssetKind[]).map((kind) => {
                  const currentUrl =
                    kind === "logoLight"
                      ? query.data?.brand.assets?.logoLightUrl
                      : kind === "logoDark"
                        ? query.data?.brand.assets?.logoDarkUrl
                        : query.data?.brand.assets?.faviconUrl;
                  const selectedFile = selectedFiles[kind];
                  return (
                    <div key={kind} className="space-y-2" data-testid={`asset-control-${kind}`}>
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">{ASSET_KIND_LABELS[kind]}</label>
                        {currentUrl ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMutation.mutate(kind)}
                            disabled={disabled}
                            data-testid={`asset-remove-${kind}`}
                          >
                            {removeMutation.isPending && removeMutation.variables === kind
                              ? "Quitando..."
                              : "Quitar"}
                          </Button>
                        ) : null}
                      </div>

                      {currentUrl ? (
                        <img
                          src={currentUrl}
                          alt={`Vista previa: ${ASSET_KIND_LABELS[kind]}`}
                          width={kind === "favicon" ? 32 : 120}
                          height={kind === "favicon" ? 32 : 40}
                          className={
                            kind === "favicon"
                              ? "h-8 w-8 object-contain"
                              : "h-10 w-auto object-contain"
                          }
                          data-testid={`asset-preview-${kind}`}
                        />
                      ) : null}

                      <input
                        id={`asset-${kind}`}
                        type="file"
                        accept={ASSET_KIND_ACCEPT}
                        disabled={disabled}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setSelectedFiles((previous) => ({ ...previous, [kind]: file }));
                        }}
                        className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                      />

                      {selectedFile ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm text-muted-foreground">{selectedFile.name}</span>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => uploadMutation.mutate({ kind, file: selectedFile })}
                            disabled={disabled}
                            data-testid={`asset-upload-${kind}`}
                          >
                            {uploadMutation.isPending && uploadMutation.variables?.kind === kind
                              ? "Subiendo..."
                              : "Subir"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedFiles((previous) => ({ ...previous, [kind]: null }));
                              const input = document.getElementById(
                                `asset-${kind}`
                              ) as HTMLInputElement | null;
                              if (input) {
                                input.value = "";
                              }
                            }}
                            disabled={disabled}
                          >
                            Limpiar
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {!query.isLoading && (
        <BrandingPreview
          primary={formState.primary}
          accent={formState.accent}
          radius={formState.radius}
          logoLightUrl={query.data?.brand.assets?.logoLightUrl}
          faviconUrl={query.data?.brand.assets?.faviconUrl}
        />
      )}
    </div>
  );
}
