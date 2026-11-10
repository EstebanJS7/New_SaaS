"use client";

import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/feedback";
import {
  getEmitterProfile,
  isFiscalFeatureMissing,
  isFiscalPermissionDenied,
  listEstablishments,
  listTimbradoRanges,
} from "./fiscal-settings-api";
import { EstablishmentsSection } from "./establishments-section";
import { IssuancePointSection } from "./issuance-point-section";
import { ProfileSection } from "./profile-section";
import { RangesSection } from "./ranges-section";
import { FiscalSecretsSection } from "./fiscal-secrets-section";
import { TaxClassificationSection } from "./tax-classification-section";
import { canUse, useCapabilities, type CapabilityRequirement } from "@/lib/capabilities";

/**
 * FISC-018 (DEC-095 delivery 2): «Configuración fiscal» — the emitter profile,
 * the establishments, the timbrado ranges and the issuance point, over the API's
 * existing routes. The API stays the authority for `fiscal.profile.manage` and the
 * `fiscal` feature: a `403` here renders a permission state and no form.
 */

export const FISCAL_SETTINGS_QUERY_KEY = ["fiscal-settings"] as const;

/**
 * What each fiscal settings section needs ([[UX-037]]), mirroring
 * `apps/api/src/fiscal/timbrado/timbrado.controller.ts` (profile,
 * establishments, ranges, issuance point: `fiscal.profile.manage`),
 * `fiscal/tax-classification/tax-classification.ts` (same key),
 * `fiscal/signing-material/signing-material.controller.ts` and
 * `fiscal/csc/csc.controller.ts` (`fiscal.signing_material.manage`), with the
 * `fiscal` entitlement every one of those services re-checks.
 */
export const FISCAL_SETTINGS_ACTIONS = {
  feature: { feature: "fiscal" },
  manageProfile: { permission: "fiscal.profile.manage", feature: "fiscal" },
  manageSecrets: { permission: "fiscal.signing_material.manage", feature: "fiscal" },
} as const satisfies Record<string, CapabilityRequirement>;

export function FiscalSettingsSurface(): JSX.Element {
  const queryClient = useQueryClient();
  // UX-037: a section the caller cannot manage is not offered (or read).
  const capabilities = useCapabilities();
  const hasFiscal = canUse(capabilities, FISCAL_SETTINGS_ACTIONS.feature);
  const canProfile = canUse(capabilities, FISCAL_SETTINGS_ACTIONS.manageProfile);
  const canSecrets = canUse(capabilities, FISCAL_SETTINGS_ACTIONS.manageSecrets);
  const profile = useQuery({
    queryKey: [...FISCAL_SETTINGS_QUERY_KEY, "profile"],
    queryFn: getEmitterProfile,
    retry: false,
    enabled: canProfile,
  });
  const establishments = useQuery({
    queryKey: [...FISCAL_SETTINGS_QUERY_KEY, "establishments"],
    queryFn: listEstablishments,
    retry: false,
    enabled: canProfile,
  });
  const ranges = useQuery({
    queryKey: [...FISCAL_SETTINGS_QUERY_KEY, "ranges"],
    queryFn: listTimbradoRanges,
    retry: false,
    enabled: canProfile,
  });
  const refresh = (part: "profile" | "establishments" | "ranges") =>
    void queryClient.invalidateQueries({ queryKey: [...FISCAL_SETTINGS_QUERY_KEY, part] });

  const errors = [profile.error, establishments.error, ranges.error];
  const permissionDenied =
    (hasFiscal && !canProfile && !canSecrets) || errors.some(isFiscalPermissionDenied);
  const featureMissing = !hasFiscal || errors.some(isFiscalFeatureMissing);

  return (
    <div className="space-y-6" data-testid="fiscal-settings-surface">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Configuración / Configuración fiscal</p>
          <h1 className="text-2xl font-semibold tracking-tight">Configuración fiscal</h1>
          <p className="text-sm text-muted-foreground">
            Lo que la clínica necesita para emitir facturas y notas de crédito electrónicas.
          </p>
        </div>
      </div>

      {permissionDenied ? (
        <EmptyState
          icon="shield"
          title="No tenés permiso para ver la configuración fiscal"
          description="Pedile a quien administra la clínica que la gestione."
        />
      ) : featureMissing ? (
        <EmptyState
          icon="shield"
          title="La facturación electrónica no está habilitada"
          description="Esta clínica no tiene la función fiscal en su plan."
        />
      ) : (
        <>
          {canProfile && (
            <>
              <ProfileSection
                profile={profile.data}
                isLoading={profile.isLoading}
                error={profile.error}
                onRetry={() => void profile.refetch()}
                onSaved={() => refresh("profile")}
              />
              <EstablishmentsSection
                establishments={establishments.data}
                isLoading={establishments.isLoading}
                error={establishments.error}
                onRetry={() => void establishments.refetch()}
                onSaved={() => refresh("establishments")}
              />
              <RangesSection
                ranges={ranges.data}
                establishments={establishments.data ?? []}
                isLoading={ranges.isLoading}
                error={ranges.error}
                onRetry={() => void ranges.refetch()}
                onSaved={() => refresh("ranges")}
              />
              <TaxClassificationSection />
            </>
          )}
          {canSecrets && (
            <>
              <FiscalSecretsSection kind="signing-material" />
              <FiscalSecretsSection kind="csc" />
            </>
          )}
          {canProfile && (
            <IssuancePointSection
              profile={profile.data}
              establishments={establishments.data ?? []}
              ranges={ranges.data}
              isLoading={profile.isLoading || ranges.isLoading}
              onDeclared={() => refresh("profile")}
            />
          )}
        </>
      )}
    </div>
  );
}
