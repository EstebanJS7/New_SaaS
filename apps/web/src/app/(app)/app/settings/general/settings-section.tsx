"use client";

import type { JSX, ReactNode } from "react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/feedback";
import {
  fetchSettings,
  settingsErrorMessage,
  settingsQueryKey,
  updateSettings,
  type SettingsData,
} from "./general-settings-api";
import type { SettingsNamespace } from "./general-settings-rules";

/** What a namespace form receives from its section. */
export interface SectionFormProps {
  /** The namespace as the API answered it (stored values over defaults). */
  readonly settings: SettingsData;
  /** Sends a partial patch; only call it with a non-empty patch. */
  readonly onSave: (patch: Record<string, unknown>) => void;
  readonly saving: boolean;
}

/**
 * One namespace of «Configuración › General»: reads it, renders its form, saves
 * a partial patch and refreshes it from the API. Loading, read failure, save
 * refusal and success are shown inside the section, so one namespace failing
 * never hides another.
 */
export function SettingsSection({
  namespace,
  title,
  description,
  renderForm,
}: {
  namespace: SettingsNamespace;
  title: string;
  description: string;
  renderForm: (props: SectionFormProps) => ReactNode;
}): JSX.Element {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: settingsQueryKey(namespace),
    queryFn: () => fetchSettings(namespace),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateSettings(namespace, patch),
    onMutate: () => setSaved(false),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey(namespace) });
    },
  });
  const failure = save.error ? settingsErrorMessage(save.error) : null;

  return (
    <section
      aria-labelledby={titleId}
      data-testid={`settings-section-${namespace}`}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
    >
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {query.isLoading ? <ListSkeleton label={`Cargando ${title}…`} rows={1} /> : null}
      {query.error ? (
        <ErrorState
          message="No se pudo cargar esta configuración."
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data ? (
        // Re-mounted on fresh data, so the draft starts from what the API stored.
        <div key={JSON.stringify(query.data)}>
          {renderForm({
            settings: query.data,
            onSave: (patch) => save.mutate(patch),
            saving: save.isPending,
          })}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">{failure.message}</p>
          {failure.detail ? <p className="mt-1 text-muted-foreground">{failure.detail}</p> : null}
        </div>
      ) : null}
      {saved ? (
        <p
          role="status"
          className="rounded-lg border border-status-success/20 bg-status-success/10 p-4 text-sm"
        >
          Se guardaron los cambios.
        </p>
      ) : null}
    </section>
  );
}

/** The section's submit button: disabled while nothing changed or a save runs. */
export function SaveButton({ dirty, saving }: { dirty: boolean; saving: boolean }): JSX.Element {
  return (
    <Button type="submit" disabled={!dirty} loading={saving}>
      Guardar
    </Button>
  );
}
