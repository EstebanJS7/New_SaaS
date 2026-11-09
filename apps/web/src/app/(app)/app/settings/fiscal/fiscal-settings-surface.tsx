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

/**
 * FISC-018 (DEC-095 delivery 2): «Configuración fiscal» — the emitter profile,
 * the establishments, the timbrado ranges and the issuance point, over the API's
 * existing routes. The API stays the authority for `fiscal.profile.manage` and the
 * `fiscal` feature: a `403` here renders a permission state and no form.
 */

export const FISCAL_SETTINGS_QUERY_KEY = ["fiscal-settings"] as const;

export function FiscalSettingsSurface(): JSX.Element {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: [...FISCAL_SETTINGS_QUERY_KEY, "profile"],
    queryFn: getEmitterProfile,
    retry: false,
  });
  const establishments = useQuery({
    queryKey: [...FISCAL_SETTINGS_QUERY_KEY, "establishments"],
    queryFn: listEstablishments,
    retry: false,
  });
  const ranges = useQuery({
    queryKey: [...FISCAL_SETTINGS_QUERY_KEY, "ranges"],
    queryFn: listTimbradoRanges,
    retry: false,
  });
  const refresh = (part: "profile" | "establishments" | "ranges") =>
    void queryClient.invalidateQueries({ queryKey: [...FISCAL_SETTINGS_QUERY_KEY, part] });

  const errors = [profile.error, establishments.error, ranges.error];
  const permissionDenied = errors.some(isFiscalPermissionDenied);
  const featureMissing = errors.some(isFiscalFeatureMissing);

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
          <IssuancePointSection
            profile={profile.data}
            establishments={establishments.data ?? []}
            ranges={ranges.data}
            isLoading={profile.isLoading || ranges.isLoading}
            onDeclared={() => refresh("profile")}
          />
        </>
      )}
    </div>
  );
}
