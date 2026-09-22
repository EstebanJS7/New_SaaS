"use client";

import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  amendEncounter,
  closeEncounter,
  createEncounter,
  isClinicalConflict,
  isClinicalPermissionDenied,
  listEncounters,
  updateDraft,
  userFacingClinicalError,
  type ClinicalEncounter,
  type ClinicalEncounterContent,
  type ClinicalEncounterStatus,
} from "./clinical-api";

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

/** Empty/whitespace input persists as `null`; the API accepts nullable fields. */
function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatRecordedDate(value: string): string {
  return value.slice(0, 10);
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
      {isDraft ? "Draft" : "Closed"}
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
        <CardTitle>{title}</CardTitle>
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
      <span>This record changed on the server. Reload the latest version before saving again.</span>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        Reload latest
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
        className={textareaClassName}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
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
}: {
  readonly patientId: string;
  readonly encounter: ClinicalEncounter;
  readonly autosaveDelayMs: number;
  readonly onNotice: (message: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const listQueryKey = ["clinical", patientId, "encounters"] as const;
  const [content, setContent] = useState<ClinicalEncounterContent>(() =>
    contentFromEncounter(encounter)
  );
  const [conflict, setConflict] = useState(false);
  // True from the moment the user acknowledges a conflict until the refetch
  // resolves and the refreshed authoritative version is adopted. Autosave stays
  // suspended across this whole window so a stale-version write can never fire
  // before (or during) a delayed refetch.
  const [reloading, setReloading] = useState(false);

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
  const baselineRef = useRef<ClinicalEncounterContent>(contentFromEncounter(encounter));
  const submittedRef = useRef<ClinicalEncounterContent | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const invalidate = (): void => {
    void refreshList();
  };

  /** Awaitable list refresh used by the conflict-reload lifecycle. */
  function refreshList(): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: listQueryKey });
  }

  /** Adopts the authoritative server row into the shared encounter list cache. */
  function applyServerVersion(updated: ClinicalEncounter): void {
    appliedVersionRef.current = Math.max(appliedVersionRef.current, updated.version);
    baselineRef.current = contentFromEncounter(updated);
    queryClient.setQueryData<ClinicalEncounter[]>(listQueryKey, (previous) =>
      previous ? previous.map((item) => (item.id === updated.id ? updated : item)) : previous
    );
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const submitted = { ...contentRef.current };
      submittedRef.current = submitted;
      return updateDraft(patientId, encounterRef.current.id, {
        ...submitted,
        version: encounterRef.current.version,
      });
    },
    onSuccess: (updated) => {
      applyServerVersion(updated);
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
      onNotice("Draft saved.");
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
      if (!mountedRef.current) return;
      setConflict(false);
      onNotice("Encounter closed.");
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

  const saveDraftRef = useRef(saveMutation.mutate);
  saveDraftRef.current = saveMutation.mutate;

  // Debounced versioned autosave. Suspended while a write is in flight, while
  // the editor is in conflict, across the whole conflict-reload lifecycle, or
  // when the save permission is unavailable. Cleanup cancels a pending timer on
  // every change and on unmount.
  useEffect(() => {
    if (conflict || reloading || saveDenied || busy || !isDirty) return;
    const timer = setTimeout(() => {
      if (!mountedRef.current) return;
      saveDraftRef.current();
    }, autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [content, conflict, reloading, saveDenied, busy, isDirty, autosaveDelayMs]);

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
          <span className="text-sm font-medium">Encounter {encounter.id.slice(0, 8)}</span>
          <EncounterStatusBadge status={encounter.status} />
        </div>
        <span className="text-xs text-muted-foreground">
          Version {encounter.version} · updated {formatRecordedDate(encounter.updatedAt)}
        </span>
      </div>

      {conflict && (
        <ConflictNotice
          onReload={() => {
            void handleReload();
          }}
        />
      )}
      {error && !conflict && denied && (
        <PermissionDeniedAlert message={userFacingClinicalError(error)} />
      )}
      {error && !conflict && !denied && <ErrorAlert message={userFacingClinicalError(error)} />}

      <EncounterField
        id="reasonForVisit"
        label="Reason for visit"
        value={content.reasonForVisit}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, reasonForVisit: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <EncounterField
        id="anamnesis"
        label="Anamnesis"
        value={content.anamnesis}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, anamnesis: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <EncounterField
        id="diagnosis"
        label="Diagnosis"
        value={content.diagnosis}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, diagnosis: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <EncounterField
        id="treatmentPlan"
        label="Treatment plan"
        value={content.treatmentPlan}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, treatmentPlan: toNullable(value) }))
        }
        disabled={saveDenied}
      />
      <div data-testid="staff-internal-notes">
        <EncounterField
          id="internalNotes"
          label="Internal notes"
          value={content.internalNotes}
          onChange={(value) =>
            setContent((previous) => ({ ...previous, internalNotes: toNullable(value) }))
          }
          disabled={saveDenied}
          hint="Staff only. Never shown to the customer or in the Portal."
        />
      </div>
      <EncounterField
        id="clientSummary"
        label="Client summary"
        value={content.clientSummary}
        onChange={(value) =>
          setContent((previous) => ({ ...previous, clientSummary: toNullable(value) }))
        }
        disabled={saveDenied}
      />

      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {conflict
          ? "Draft not saved: resolve the conflict above."
          : reloading
            ? "Reloading latest version..."
            : busy
              ? "Saving..."
              : isDirty
                ? "Unsaved changes"
                : "All changes saved"}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => closeMutation.mutate()}
          disabled={busy || conflict || closeDenied}
        >
          {closeMutation.isPending ? "Closing..." : "Close encounter"}
        </Button>
      </div>
    </div>
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
      onNotice("Amendment recorded.");
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
      <p className="text-sm font-medium">Amend closed encounter</p>
      <p className="text-xs text-muted-foreground">
        The original stays immutable; the amendment is a new linked, audited record.
      </p>
      {mutation.error && denied && (
        <PermissionDeniedAlert message={userFacingClinicalError(mutation.error)} />
      )}
      {mutation.error && !denied && (
        <ErrorAlert message={userFacingClinicalError(mutation.error)} />
      )}
      <div className="space-y-2">
        <label htmlFor="amendmentReason" className="text-sm font-medium">
          Amendment reason
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
        {mutation.isPending ? "Submitting..." : "Record amendment"}
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
 */
export function ClinicalWorkspace({
  patientId,
  autosaveDelayMs = CLINICAL_AUTOSAVE_DELAY_MS,
}: {
  readonly patientId: string;
  readonly autosaveDelayMs?: number;
}): JSX.Element {
  const queryClient = useQueryClient();
  const listQueryKey = ["clinical", patientId, "encounters"] as const;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const encounters = useQuery({
    queryKey: listQueryKey,
    queryFn: () => listEncounters(patientId),
  });

  const createMutation = useMutation({
    mutationFn: () => createEncounter(patientId),
    onSuccess: (created) => {
      setSelectedId(created.id);
      setNotice("Draft encounter created.");
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
  });
  const createDenied = mutationDenied(createMutation.error);

  const data = encounters.data;
  const selected = data?.find((encounter) => encounter.id === selectedId) ?? null;
  const selectedIsDraft = selected?.status === "DRAFT";
  const selectedIsClosed = selected?.status === "CLOSED";

  return (
    <SectionCard
      title="Clinical records"
      description="Draft, close and amend this patient's clinical encounters."
    >
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
        <p className="text-sm text-muted-foreground">Loading clinical records...</p>
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
            disabled={createMutation.isPending || createDenied}
          >
            {createMutation.isPending ? "Creating..." : "New encounter"}
          </Button>

          {data && data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clinical encounters yet.</p>
          ) : (
            <ul className="space-y-2">
              {data?.map((encounter) => {
                const isSelected = encounter.id === selectedId;
                return (
                  <li key={encounter.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(encounter.id)}
                      aria-current={isSelected ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left text-sm hover:bg-secondary ${
                        isSelected ? "border-primary" : "border-input"
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        {encounter.reasonForVisit?.trim()
                          ? encounter.reasonForVisit.trim()
                          : "Untitled encounter"}
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

          {selected && selectedIsDraft && (
            <EncounterEditor
              key={selected.id}
              patientId={patientId}
              encounter={selected}
              autosaveDelayMs={autosaveDelayMs}
              onNotice={setNotice}
            />
          )}
          {selected && selectedIsClosed && (
            <AmendmentForm
              key={selected.id}
              patientId={patientId}
              encounter={selected}
              onNotice={setNotice}
            />
          )}
        </>
      )}
    </SectionCard>
  );
}
