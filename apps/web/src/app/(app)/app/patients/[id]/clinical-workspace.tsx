"use client";

import { useStaffResumeTarget } from "@/providers/staff-resume-target";
import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { ClinicalAssociations } from "@/components/veterinary/clinical-associations";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { formatEsPyDateOnly, formatEsPyInstant } from "@/lib/es-py-format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  ApiRequestError,
  amendEncounter,
  closeEncounter,
  createEncounter,
  isClinicalConflict,
  isClinicalPermissionDenied,
  listEncounters,
  getClinicalLinks,
  getAppointmentEncounters,
  updateDraft,
  userFacingClinicalError,
  type ClinicalEncounter,
  type ClinicalEncounterContent,
  type ClinicalEncounterStatus,
} from "./clinical-api";
import { ClinicalRecordsSection } from "./clinical-records";
import {
  clearClinicalRecovery,
  readClinicalRecovery,
  retainClinicalRecovery,
} from "./clinical-draft-recovery";

/**
 * Debounce window for the on-change versioned draft autosave. The version guard,
 * not the timing, is the concurrency contract: this value only coalesces a burst
 * of keystrokes into a single write. Tests inject a smaller value.
 */
export const CLINICAL_AUTOSAVE_DELAY_MS = 800;

const textareaClassName =
  "min-h-[4.5rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function contentFromEncounter(encounter: ClinicalEncounter): ClinicalEncounterContent {
  return {
    reasonForVisit: encounter.reasonForVisit,
    anamnesis: encounter.anamnesis,
    diagnosis: encounter.diagnosis,
    treatmentPlan: encounter.treatmentPlan,
    internalNotes: encounter.internalNotes,
    clientSummary: encounter.clientSummary,
  };
}

function inputValue(value: string | null): string {
  return value ?? "";
}

/** Keep the working copy intact while typing; empty input persists as null. */
function toNullable(value: string): string | null {
  return value.length > 0 ? value : null;
}

function formatRecordedDate(value: string): string {
  return value.includes("T") ? formatEsPyInstant(value) : formatEsPyDateOnly(value);
}

/** Field-by-field equality so an unchanged draft is never written back. */
function sameContent(a: ClinicalEncounterContent, b: ClinicalEncounterContent): boolean {
  return (
    a.reasonForVisit === b.reasonForVisit &&
    a.anamnesis === b.anamnesis &&
    a.diagnosis === b.diagnosis &&
    a.treatmentPlan === b.treatmentPlan &&
    a.internalNotes === b.internalNotes &&
    a.clientSummary === b.clientSummary
  );
}

/**
 * True when a mutation failed on an authorization or entitlement gate. Retrying
 * cannot succeed, so the matching action is disabled and rendered as a neutral
 * permission notice instead of a red "something broke" alert.
 */
function mutationDenied(error: Error | null | undefined): boolean {
  return error !== null && error !== undefined && isClinicalPermissionDenied(error);
}

function EncounterStatusBadge({
  status,
}: {
  readonly status: ClinicalEncounterStatus;
}): JSX.Element {
  const isDraft = status === "DRAFT";
  return (
    <span
      className={
        isDraft
          ? "rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
          : "rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground"
      }
    >
      {isDraft ? "Borrador" : "Cerrada"}
    </span>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ErrorAlert({ message }: { readonly message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

/**
 * Permission/entitlement denial is a first-class UX state: neutral styling and
 * no mutation affordances, rather than a red "something broke" alert.
 */
function PermissionDeniedAlert({ message }: { readonly message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-input bg-secondary p-4 text-sm text-secondary-foreground"
    >
      {message}
    </div>
  );
}

function ConflictNotice({ onReload }: { readonly onReload: () => void }): JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input bg-secondary p-3 text-sm text-secondary-foreground"
    >
      <span>
        Otra persona modificó esta ficha. Cargá la versión más reciente antes de volver a guardar.
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        Cargar versión actual
      </Button>
    </div>
  );
}

function EncounterField({
  id,
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
  readonly hint?: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        value={inputValue(value)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={(value?.length ?? 0) > 10_000 || undefined}
        aria-describedby={`${id}-help${(value?.length ?? 0) > 10_000 ? ` ${id}-error` : ""}`}
        className={textareaClassName}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {hint ? `${hint} ` : ""}
        {value?.length ?? 0} / 10.000 caracteres.
      </p>
      {(value?.length ?? 0) > 10_000 && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {label}: el máximo es de 10.000 caracteres. Acortá el texto para guardar.
        </p>
      )}
    </div>
  );
}

/**
 * Draft editor for one encounter.
 *
 * Local field state is the working copy. A debounced, version-guarded autosave
 * persists every change using the version last read from the server, so a
 * concurrent writer surfaces as a reload prompt instead of a silent overwrite.
 * The pending timer is cancelled on every change and on unmount, and an
 * in-flight response never clobbers newer local edits (the fields stay editable
 * while a write is in flight; the next debounce writes them against the
 * refreshed version). A 409 keeps the draft intact; the explicit "Reload
 * latest" action clears the conflict and the stale mutation error but keeps
 * autosave suspended until the refetch resolves and the refreshed
 * authoritative version is adopted, so a stale-version write can never fire
 * during a delayed reload.
 */
function EncounterEditor({
  patientId,
  encounter,
  autosaveDelayMs,
  onNotice,
  onPendingChange,
}: {
  readonly onPendingChange: (pending: boolean) => void;
  readonly patientId: string;
  readonly encounter: ClinicalEncounter;
  readonly autosaveDelayMs: number;
  readonly onNotice: (message: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const listQueryKey = ["clinical", patientId, "encounters"] as const;
  const [recovered] = useState(() => {
    const draft = readClinicalRecovery(queryClient, patientId);
    return draft?.encounterId === encounter.id &&
      !sameContent(draft.content, contentFromEncounter(encounter))
      ? draft
      : undefined;
  });
  const [recoveryReview, setRecoveryReview] = useState(recovered !== undefined);
  const recoveryVersionRef = useRef(recovered?.version);
  const [content, setContent] = useState<ClinicalEncounterContent>(
    () => recovered?.content ?? contentFromEncounter(encounter)
  );
  const [conflict, setConflict] = useState(
    recovered !== undefined && recovered.version !== encounter.version
  );
  // True from the moment the user acknowledges a conflict until the refetch
  // resolves and the refreshed authoritative version is adopted. Autosave stays
  // suspended across this whole window so a stale-version write can never fire
  // before (or during) a delayed refetch.
  const [reloading, setReloading] = useState(false);
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [exitHref, setExitHref] = useState<string | null>(null);
  const leaveConfirmedRef = useRef(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeDialogError, setCloseDialogError] = useState<string | null>(null);

  // Refs keep the debounced write and the server-sync effect free of stale
  // closures without re-creating the timer callback on every keystroke.
  const contentRef = useRef(content);
  contentRef.current = content;
  // Highest server version whose content has been applied to the shared list
  // cache, the ref used by the NEXT mutation, and/or the local baseline.
  // Refetches can resolve out of order (an older response landing after a newer
  // save echo), and nothing downstream may follow the version backwards.
  const appliedVersionRef = useRef<number>(encounter.version);
  const encounterRef = useRef(encounter);
  // Adopt the prop row only when it is at least as new as the version already
  // applied. Without this a regressing refetch would update the ref the NEXT
  // mutation reads, so autosave would submit a stale version and earn an
  // avoidable 409. The comparison is `>=`, not `>`: a same-version refetch that
  // carries newer content is legitimate and is exactly the originally observed
  // failure. The sync effect below applies the same rule to the baseline and the
  // visible draft, and `handleReload` applies it to the conflict refresh.
  if (encounter.version >= appliedVersionRef.current) {
    encounterRef.current = encounter;
  }
  const baselineRef = useRef<ClinicalEncounterContent>(
    recovered?.baseline ?? contentFromEncounter(encounter)
  );
  const submittedRef = useRef<ClinicalEncounterContent | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    if (
      !recovered &&
      readClinicalRecovery(queryClient, patientId)?.encounterId === encounterRef.current.id
    )
      clearClinicalRecovery(queryClient, patientId);
    return () => {
      mountedRef.current = false;
      if (leaveConfirmedRef.current || encounterRef.current.status !== "DRAFT") return;
      if (!sameContent(contentRef.current, baselineRef.current)) {
        retainClinicalRecovery(queryClient, patientId, {
          encounterId: encounterRef.current.id,
          version: recoveryVersionRef.current ?? encounterRef.current.version,
          baseline: baselineRef.current,
          content: contentRef.current,
        });
      }
    };
  }, [patientId, queryClient, recovered]);

  const invalidate = (): void => {
    void refreshList();
  };

  /** Awaitable list refresh used by the conflict-reload lifecycle. */
  function refreshList(): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: listQueryKey });
  }

  /** Adopts the authoritative server row into the shared encounter list cache. */
  function applyServerVersion(updated: ClinicalEncounter): void {
    // A close may follow mutateAsync before React renders the updated cache.
    // Its command must already see the authoritative save response's version.
    if (updated.version >= appliedVersionRef.current) encounterRef.current = updated;
    appliedVersionRef.current = Math.max(appliedVersionRef.current, updated.version);
    baselineRef.current = contentFromEncounter(updated);
    queryClient.setQueryData<ClinicalEncounter[]>(listQueryKey, (previous) =>
      previous ? previous.map((item) => (item.id === updated.id ? updated : item)) : previous
    );
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (
        recoveryVersionRef.current !== undefined &&
        recoveryVersionRef.current !== encounterRef.current.version
      ) {
        throw new ApiRequestError("CONFLICT", "La consulta cambió mientras estabas fuera.", 409);
      }
      const submitted = { ...contentRef.current };
      if (Object.values(submitted).some((value) => value !== null && value.length > 10_000)) {
        throw new Error("Acortá los campos indicados antes de guardar.");
      }
      submittedRef.current = submitted;
      return updateDraft(patientId, encounterRef.current.id, {
        ...submitted,
        version: encounterRef.current.version,
      });
    },
    onSuccess: (updated) => {
      applyServerVersion(updated);
      const retained = readClinicalRecovery(queryClient, patientId);
      if (retained?.encounterId === updated.id && updated.version >= retained.version) {
        if (submittedRef.current && sameContent(retained.content, submittedRef.current)) {
          clearClinicalRecovery(queryClient, patientId);
        } else {
          retainClinicalRecovery(queryClient, patientId, {
            ...retained,
            version: updated.version,
            baseline: contentFromEncounter(updated),
          });
        }
      }
      recoveryVersionRef.current = undefined;
      if (mountedRef.current) setRecoveryReview(false);
      // Adopt the server echo only when the draft did not change mid-flight;
      // otherwise keep the newer local edits and let the next debounce write
      // them against the refreshed version.
      if (submittedRef.current && sameContent(contentRef.current, submittedRef.current)) {
        contentRef.current = contentFromEncounter(updated);
        setContent(contentRef.current);
      }
      submittedRef.current = null;
      if (!mountedRef.current) return;
      setConflict(false);
      onNotice("Borrador guardado.");
      invalidate();
    },
    onError: (error) => {
      if (isClinicalConflict(error) && mountedRef.current) {
        setConflict(true);
      }
    },
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      closeEncounter(patientId, encounterRef.current.id, encounterRef.current.version),
    onSuccess: (updated) => {
      applyServerVersion(updated);
      clearClinicalRecovery(queryClient, patientId);
      if (!mountedRef.current) return;
      setConflict(false);
      onNotice("Ficha clínica cerrada.");
      invalidate();
    },
    onError: (error) => {
      if (isClinicalConflict(error) && mountedRef.current) {
        setConflict(true);
      }
    },
  });

  // Adopt a refetched server version only when it moves forward and the local
  // draft has no unsaved edits; a dirty draft is preserved and its stale version
  // surfaces as a 409. The version check is monotonic because a refetch can
  // resolve out of order: a response older than the version already applied by
  // a save echo or a previous refetch must not overwrite the draft.
  useEffect(() => {
    if (encounter.version < appliedVersionRef.current) return;
    if (
      recoveryVersionRef.current !== undefined &&
      encounter.version !== recoveryVersionRef.current
    )
      setConflict(true);
    appliedVersionRef.current = encounter.version;
    const serverContent = contentFromEncounter(encounter);
    const localIsDirty = !sameContent(contentRef.current, baselineRef.current);
    baselineRef.current = serverContent;
    if (!localIsDirty) {
      contentRef.current = serverContent;
      setContent(serverContent);
    }
  }, [encounter]);

  const error: Error | null = saveMutation.error ?? closeMutation.error;
  const denied = mutationDenied(error);
  const saveDenied = mutationDenied(saveMutation.error);
  const closeDenied = mutationDenied(closeMutation.error);
  const isDirty = !sameContent(content, baselineRef.current);
  const busy = saveMutation.isPending || closeMutation.isPending;
  const invalidContent = Object.values({ ...content }).some(
    (value) => value !== null && value.length > 10_000
  );
  const pendingChanges = isDirty || busy;
  useEffect(() => {
    onPendingChange(pendingChanges);
  }, [pendingChanges, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  useEffect(() => {
    if (!pendingChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (leaveConfirmedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeLink = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setNavigationBlocked(true);
      setExitHref(destination.href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [pendingChanges]);

  async function confirmCloseEncounter(): Promise<void> {
    setCloseDialogError(null);
    try {
      if (conflict || reloading || saveDenied) {
        throw new Error(
          "Resolvé el conflicto y cargá la versión más reciente antes de cerrar la ficha."
        );
      }
      if (isDirty) {
        await saveMutation.mutateAsync();
        // A keystroke can arrive while the save is in flight. Closing in that
        // case would make the still-dirty content immutable and lose the last
        // local edit, so only close once the snapshot is authoritative.
        if (!sameContent(contentRef.current, baselineRef.current)) {
          throw new Error(
            "Hubo cambios durante el guardado. Volvé a guardar antes de cerrar la ficha."
          );
        }
      }
      await closeMutation.mutateAsync();
    } catch (closeError) {
      setCloseDialogError(
        closeError instanceof Error
          ? userFacingClinicalError(closeError)
          : "No se pudo cerrar la ficha. Revisá el estado y volvé a intentar."
      );
      throw closeError;
    }
  }

  const saveDraftRef = useRef(saveMutation.mutate);
  saveDraftRef.current = saveMutation.mutate;

  // Debounced versioned autosave. Suspended while a write is in flight, while
  // the editor is in conflict, across the whole conflict-reload lifecycle, or
  // when the save permission is unavailable. Cleanup cancels a pending timer on
  // every change and on unmount.
  useEffect(() => {
    if (
      conflict ||
      reloading ||
      saveDenied ||
      busy ||
      closeDialogOpen ||
      recoveryReview ||
      exitHref !== null ||
      invalidContent ||
      saveMutation.error ||
      !isDirty
    )
      return;
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      saveDraftRef.current();
    }, autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [
    content,
    conflict,
    reloading,
    saveDenied,
    busy,
    closeDialogOpen,
    recoveryReview,
    exitHref,
    invalidContent,
    saveMutation.error,
    isDirty,
    autosaveDelayMs,
  ]);

  async function handleReload(): Promise<void> {
    // Drop the stale write error together with the conflict flag, but keep
    // autosave suspended until the refetch resolves and the refreshed
    // authoritative version is adopted below. The local draft is preserved.
    saveMutation.reset();
    closeMutation.reset();
    setConflict(false);
    setReloading(true);
    try {
      await refreshList();
      const refreshed = queryClient
        .getQueryData<ClinicalEncounter[]>(listQueryKey)
        ?.find((item) => item.id === encounterRef.current.id);
      if (refreshed && refreshed.version >= appliedVersionRef.current) {
        // Same monotonic rule as every other adoption: a refreshed row older
        // than the applied version must not regress the ref or install an older
        // baseline. A same-version row is admissible because it can carry newer
        // content.
        recoveryVersionRef.current = undefined;
        setRecoveryReview(false);
        clearClinicalRecovery(queryClient, patientId);
        encounterRef.current = refreshed;
        appliedVersionRef.current = Math.max(appliedVersionRef.current, refreshed.version);
        baselineRef.current = contentFromEncounter(refreshed);
      }
    } finally {
      if (mountedRef.current) setReloading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Consulta {encounter.id.slice(0, 8)}</span>
          <EncounterStatusBadge status={encounter.status} />
        </div>
        <span className="text-xs text-muted-foreground">
          Versión {encounter.version} · actualizado {formatRecordedDate(encounter.updatedAt)}
        </span>
      </div>

      {recoveryReview && (
        <p role="status" className="rounded-lg border border-border bg-secondary p-3 text-sm">
          Recuperamos los cambios pendientes de esta consulta al volver a la ficha. Revisalos y usá
          Guardar borrador para confirmarlos. Se conservan temporalmente en memoria, sin escribirlos
          en el almacenamiento del navegador.
        </p>
      )}
      {conflict && (
        <ConflictNotice
          onReload={() => {
            void handleReload();
          }}
        />
      )}
      {error && !conflict && denied && !closeDialogOpen && (
        <PermissionDeniedAlert message={userFacingClinicalError(error)} />
      )}
      {error && !conflict && !denied && !closeDialogOpen && (
        <ErrorAlert message={userFacingClinicalError(error)} />
      )}

      <EncounterField
        id="reasonForVisit"
        label="Motivo de consulta"
        value={content.reasonForVisit}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, reasonForVisit: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <EncounterField
        id="anamnesis"
        label="Antecedentes"
        value={content.anamnesis}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, anamnesis: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <EncounterField
        id="diagnosis"
        label="Diagnóstico"
        value={content.diagnosis}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, diagnosis: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <EncounterField
        id="treatmentPlan"
        label="Plan de tratamiento"
        value={content.treatmentPlan}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, treatmentPlan: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <div data-testid="staff-internal-notes">
        <EncounterField
          id="internalNotes"
          label="Notas internas"
          value={content.internalNotes}
          onChange={(value) =>
            setContent((previous) => ({ ...previous, internalNotes: toNullable(value) }))
          }
          disabled={saveDenied}
          hint="Solo para el equipo veterinario. No se muestran al cliente ni en el portal."
        />
      </div>
      <EncounterField
        id="clientSummary"
        label="Resumen para el cliente"
        value={content.clientSummary}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, clientSummary: toNullable(value) }))
        }
        disabled={saveDenied}
      />

      {navigationBlocked && pendingChanges && (
        <p role="alert" className="rounded-md border border-border bg-secondary p-3 text-sm">
          Hay cambios pendientes. Guardá el borrador o corregí el error antes de salir. Podés
          recorrer las secciones de esta ficha.
        </p>
      )}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {invalidContent
          ? "No se guardó: corregí los campos indicados."
          : saveMutation.error && !conflict
            ? "No se pudo guardar. Revisá el mensaje y usá Guardar borrador para reintentar."
            : conflict
              ? "Borrador sin guardar: resolvé el conflicto indicado arriba."
              : reloading
                ? "Cargando la versión más reciente…"
                : busy
                  ? "Guardando…"
                  : isDirty
                    ? "Hay cambios sin guardar"
                    : "Todos los cambios están guardados"}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={busy || !isDirty || invalidContent || conflict || reloading || saveDenied}
        >
          Guardar borrador
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setCloseDialogError(null);
            setCloseDialogOpen(true);
          }}
          disabled={
            busy ||
            recoveryReview ||
            invalidContent ||
            conflict ||
            reloading ||
            closeDenied ||
            saveDenied
          }
        >
          {closeMutation.isPending ? "Cerrando…" : "Cerrar ficha clínica"}
        </Button>
      </div>
      <ConfirmActionDialog
        open={exitHref !== null}
        onOpenChange={(open) => {
          if (!open) setExitHref(null);
        }}
        title="Salir sin guardar"
        description="Hay cambios pendientes en esta consulta. Podés volver para guardarlos o salir y perder únicamente los cambios que todavía no llegaron al servidor."
        cancelLabel="Seguir editando"
        confirmLabel="Salir sin guardar"
        pending={busy}
        confirmDisabled={busy}
        onConfirm={() => {
          if (exitHref !== null && !busy) {
            clearClinicalRecovery(queryClient, patientId);
            leaveConfirmedRef.current = true;
            window.location.assign(exitHref);
          }
        }}
      />
      <ConfirmActionDialog
        open={closeDialogOpen}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setCloseDialogError(null);
            setCloseDialogOpen(false);
          }
        }}
        title="Cerrar ficha clínica"
        description="La ficha quedará de solo lectura. Antes de cerrarla, vamos a guardar el borrador pendiente."
        confirmLabel="Guardar y cerrar"
        confirmVariant="default"
        pendingLabel="Guardando y cerrando…"
        pending={busy}
        confirmDisabled={conflict || reloading || closeDenied || saveDenied}
        errorMessage={
          closeDialogError ??
          (conflict
            ? "Hay un conflicto de versión. Cargá la versión más reciente antes de cerrar."
            : undefined)
        }
        onConfirm={confirmCloseEncounter}
      >
        <EncounterSummary content={content} />
        <p className="mt-3 text-xs text-muted-foreground">
          Los campos vacíos son opcionales. Este cierre no completa la cita ni genera una venta.
        </p>
      </ConfirmActionDialog>
    </div>
  );
}

function EncounterSummary({
  content,
}: {
  readonly content: ClinicalEncounterContent;
}): JSX.Element {
  return (
    <dl
      tabIndex={0}
      aria-label="Resumen de la consulta"
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mt-4 grid max-h-80 gap-3 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-4 text-sm sm:grid-cols-2"
    >
      {(
        [
          ["reasonForVisit", "Motivo de consulta"],
          ["anamnesis", "Antecedentes"],
          ["diagnosis", "Diagnóstico"],
          ["treatmentPlan", "Plan de tratamiento"],
          ["clientSummary", "Resumen para el cliente"],
          ["internalNotes", "Notas internas · solo equipo"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="min-w-0">
          <dt className="font-medium">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
            {content[key]?.trim() ? content[key] : "Sin registrar"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Amendment form for a CLOSED encounter: a required reason, audited upstream. */
function AmendmentForm({
  patientId,
  encounter,
  onNotice,
}: {
  readonly patientId: string;
  readonly encounter: ClinicalEncounter;
  readonly onNotice: (message: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () => amendEncounter(patientId, encounter.id, { reason: reason.trim() }),
    onSuccess: () => {
      setReason("");
      onNotice("Enmienda registrada.");
      void queryClient.invalidateQueries({ queryKey: ["clinical", patientId, "encounters"] });
    },
  });

  const denied = mutationDenied(mutation.error);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border bg-card p-4">
      <p className="text-sm font-medium">Enmendar ficha clínica cerrada</p>
      <p className="text-xs text-muted-foreground">
        La ficha original permanece inmutable. La enmienda crea un registro vinculado y auditado.
      </p>
      {mutation.error && denied && (
        <PermissionDeniedAlert message={userFacingClinicalError(mutation.error)} />
      )}
      {mutation.error && !denied && (
        <ErrorAlert message={userFacingClinicalError(mutation.error)} />
      )}
      <div className="space-y-2">
        <label htmlFor="amendmentReason" className="text-sm font-medium">
          Motivo de la enmienda <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="amendmentReason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          disabled={mutation.isPending || denied}
          className={textareaClassName}
        />
      </div>
      <Button type="submit" disabled={mutation.isPending || denied || reason.trim().length === 0}>
        {mutation.isPending ? "Registrando…" : "Registrar enmienda"}
      </Button>
    </form>
  );
}

/**
 * Staff clinical workspace mounted on the Patient detail surface.
 *
 * Reachable only inside the staff `(app)` shell through the authenticated
 * `/api/clinical` proxy. Tenant identity, permissions and the `veterinary`
 * entitlement are enforced by the API; the denied/conflict states below are
 * UX-only. All styling consumes semantic tokens so the surface stays
 * brand-agnostic, and this component is never rendered inside the Portal.
 *
 * The encounter card is the original surface and is unchanged. The second card
 * is the vaccination/deworming entry path (EPIC-18 REP-010), which is the only
 * place staff can fill the due date the reports read.
 */
export function ClinicalWorkspace({
  patientId,
  initialEncounterId,
  autosaveDelayMs = CLINICAL_AUTOSAVE_DELAY_MS,
  permissions,
  appointmentId,
}: {
  readonly initialEncounterId?: string;
  readonly appointmentId?: string;
  readonly patientId: string;
  readonly autosaveDelayMs?: number;
  /** Caller permissions when the shell knows them; `undefined` means unknown. */
  readonly permissions?: readonly string[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const listQueryKey = ["clinical", patientId, "encounters"] as const;
  const [recoveryId] = useState(() => readClinicalRecovery(queryClient, patientId)?.encounterId);
  const [selectedId, setSelectedId] = useState<string | null>(
    recoveryId ?? initialEncounterId ?? null
  );
  const [recoveryAuthorized, setRecoveryAuthorized] = useState(recoveryId === undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorPending, setEditorPending] = useState(false);
  const encounters = useQuery({
    queryKey: listQueryKey,
    queryFn: () => listEncounters(patientId),
  });

  const createMutation = useMutation({
    mutationFn: () => createEncounter(patientId),
    onSuccess: (created) => {
      setSelectedId(created.id);
      setNotice("Borrador de ficha clínica creado.");
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
  });
  const createDenied = mutationDenied(createMutation.error);

  const appointmentEncounters = useQuery({
    queryKey: ["clinical-appointment-encounters", patientId, appointmentId],
    queryFn: () => getAppointmentEncounters(patientId, appointmentId!),
    enabled: appointmentId !== undefined && /^[0-9a-f-]{36}$/i.test(appointmentId),
    retry: false,
  });
  const data = encounters.data;
  const selected = data?.find((encounter) => encounter.id === selectedId) ?? null;
  const selectedLinks = useQuery({
    queryKey: ["clinical-links", patientId, selectedId],
    queryFn: () => getClinicalLinks(patientId, selectedId!),
    enabled: selected !== null,
    retry: false,
  });
  const originAppointmentId = selectedLinks.data?.appointmentId ?? appointmentId;
  useStaffResumeTarget(
    selected
      ? `/app/patients/${patientId}?encounter=${selected.id}${originAppointmentId ? `&appointment=${originAppointmentId}` : ""}#patient-clinical`
      : undefined
  );
  const selectedIsDraft = selected?.status === "DRAFT";
  const selectedIsClosed = selected?.status === "CLOSED";
  const recovery = readClinicalRecovery(queryClient, patientId);
  const recoveryReadPending = !recoveryAuthorized;
  useEffect(() => {
    if (encounters.isSuccess && !encounters.isFetching) setRecoveryAuthorized(true);
  }, [encounters.isSuccess, encounters.isFetching]);
  useEffect(() => {
    if (
      encounters.error &&
      (isClinicalPermissionDenied(encounters.error) ||
        (encounters.error instanceof ApiRequestError && encounters.error.status === 404))
    ) {
      clearClinicalRecovery(queryClient, patientId);
    }
  }, [encounters.error, patientId, queryClient]);

  return (
    <>
      <SectionCard
        title="Ficha clínica"
        description="Creá, guardá, cerrá y enmendá las consultas clínicas del paciente."
      >
        {initialEncounterId &&
          encounters.isSuccess &&
          !data?.some((row) => row.id === initialEncounterId) && (
            <p role="status" className="text-sm text-muted-foreground">
              No encontramos la consulta de retorno entre los registros disponibles. Revisá la ficha
              antes de continuar.
            </p>
          )}
        {createMutation.error &&
          (createDenied ? (
            <PermissionDeniedAlert message={userFacingClinicalError(createMutation.error)} />
          ) : (
            <ErrorAlert message={userFacingClinicalError(createMutation.error)} />
          ))}
        {notice && (
          <p role="status" aria-live="polite" className="text-sm text-status-success">
            {notice}
          </p>
        )}

        {encounters.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando fichas clínicas…</p>
        ) : encounters.error ? (
          isClinicalPermissionDenied(encounters.error) ? (
            <PermissionDeniedAlert message={userFacingClinicalError(encounters.error)} />
          ) : (
            <ErrorAlert message={userFacingClinicalError(encounters.error)} />
          )
        ) : (
          <>
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || createDenied || editorPending}
            >
              {createMutation.isPending ? "Creando…" : "Nueva consulta"}
            </Button>

            {appointmentId && (
              <section
                aria-label="Consultas de la cita"
                className="rounded-lg border border-border bg-secondary/30 p-4 space-y-2"
              >
                <h3 className="font-medium">Consultas vinculadas a la cita</h3>
                {appointmentEncounters.isPending ? (
                  <p className="text-sm">Consultando vínculos…</p>
                ) : appointmentEncounters.isError ? (
                  <p className="text-sm text-muted-foreground">
                    No pudimos consultar las atenciones de esta cita. Podés usar la ficha
                    independiente.
                  </p>
                ) : appointmentEncounters.data.encounterIds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Todavía no hay consultas vinculadas. Podés crear una y vincularla
                    explícitamente.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {appointmentEncounters.data.encounterIds.map((id) => (
                      <Button
                        key={id}
                        type="button"
                        variant="outline"
                        disabled={editorPending && id !== selectedId}
                        onClick={() => setSelectedId(id)}
                      >
                        Abrir consulta #{id.slice(0, 8)}
                      </Button>
                    ))}
                  </div>
                )}
              </section>
            )}
            {editorPending && (
              <p className="text-xs text-muted-foreground">
                Guardá los cambios pendientes antes de cambiar de consulta o crear otra.
              </p>
            )}
            {data && data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay consultas clínicas.</p>
            ) : (
              <ul className="space-y-2">
                {data?.map((encounter) => {
                  const isSelected = encounter.id === selectedId;
                  return (
                    <li key={encounter.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(encounter.id)}
                        disabled={editorPending && !isSelected}
                        aria-current={isSelected ? "true" : undefined}
                        className={`flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left text-sm hover:bg-secondary ${
                          isSelected ? "border-primary" : "border-input"
                        }`}
                      >
                        <span className="min-w-0 truncate">
                          {encounter.reasonForVisit?.trim()
                            ? encounter.reasonForVisit.trim()
                            : "Consulta sin título"}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatRecordedDate(encounter.updatedAt)}</span>
                          <EncounterStatusBadge status={encounter.status} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {recoveryReadPending && (
              <p role="status">Verificando acceso a la consulta antes de recuperar cambios…</p>
            )}
            {!recoveryReadPending && recovery && selectedIsClosed && (
              <section aria-label="Borrador recuperado sin guardar">
                <p role="alert">
                  La consulta se cerró mientras estabas fuera. Estos cambios recuperados son de solo
                  lectura; no se aplicaron al registro cerrado.
                </p>
                <EncounterSummary content={recovery.content} />
              </section>
            )}
            {selected && !recoveryReadPending && (
              <ClinicalAssociations
                key={`links-${selected.id}`}
                patientId={patientId}
                encounterId={selected.id}
                appointmentId={appointmentId}
              />
            )}
            {selected && selectedIsDraft && !recoveryReadPending && (
              <EncounterEditor
                key={selected.id}
                patientId={patientId}
                encounter={selected}
                autosaveDelayMs={autosaveDelayMs}
                onNotice={setNotice}
                onPendingChange={setEditorPending}
              />
            )}
            {selected && selectedIsClosed && (
              <section
                aria-label="Consulta cerrada"
                className="rounded-lg border border-border p-4 space-y-4"
              >
                <h3 className="font-semibold">Consulta cerrada · solo lectura</h3>
                <p className="text-sm text-muted-foreground">
                  Cerrada{" "}
                  {selected.closedAt
                    ? formatRecordedDate(selected.closedAt)
                    : "sin fecha disponible"}
                  . Las correcciones se registran mediante una enmienda.
                </p>
                <EncounterSummary content={selected} />
                <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-2">
                  <h3 className="font-medium">Siguiente paso: venta</h3>
                  <p className="text-sm text-muted-foreground">
                    La consulta quedó cerrada. Podés ir al punto de venta para seleccionar los
                    servicios o productos y revisar el cobro. Esto no completa el turno ni crea una
                    venta automáticamente.
                  </p>
                  <Link
                    className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/app/sales?patient=${patientId}&encounter=${selected.id}${originAppointmentId && /^[0-9a-f-]{36}$/i.test(originAppointmentId) ? `&appointment=${encodeURIComponent(originAppointmentId)}` : ""}`}
                  >
                    Ir al punto de venta
                  </Link>
                </div>
                <AmendmentForm
                  key={selected.id}
                  patientId={patientId}
                  encounter={selected}
                  onNotice={setNotice}
                />
              </section>
            )}
          </>
        )}
      </SectionCard>
      <section
        id="patient-prevention"
        aria-label="Prevención del paciente"
        className="scroll-mt-24"
        tabIndex={-1}
      >
        <ClinicalRecordsSection patientId={patientId} permissions={permissions} />
      </section>
    </>
  );
}
