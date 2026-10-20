"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
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
  createDeworming,
  createVaccination,
  isClinicalPermissionDenied,
  listDeworming,
  listVaccinations,
  updateDeworming,
  updateVaccination,
  userFacingClinicalError,
  type ClinicalDeworming,
  type ClinicalVaccination,
  type CreateDewormingInput,
  type CreateVaccinationInput,
  type UpdateDewormingInput,
  type UpdateVaccinationInput,
} from "./clinical-api";

/**
 * Vaccination and deworming entry surface (EPIC-18 REP-010).
 *
 * This is the staff entry path for `next_due_at`, the field [[DEC-065]] added
 * and the two due reports [[REP-006]] read. [[DEC-067]] scoped it to these two
 * record kinds: treatments, studies and weights remain API-only ([[TD-055]]).
 *
 * Three rules the code below exists to keep:
 *
 * 1. **The due date is a real state, not a blank.** An empty `nextDueAt` renders
 *    the explicit "No due date recorded" sentence, because NULL means "not
 *    monitored" and the reports omit the row rather than deriving a date.
 * 2. **A wrong due date is REMOVABLE, not only replaceable.** Clearing sends an
 *    explicit `nextDueAt: null`, which is the contract the API already ships.
 * 3. **This surface computes nothing.** Every instant comes from the API and
 *    every instant it sends is the browser's conversion of the wall-clock value
 *    staff typed into `<input type="datetime-local">`, so the due reports bucket
 *    the row to the local day the veterinarian actually chose.
 *
 * Data classification: the vaccine/product name and both instants are
 * CONFIDENTIAL clinical data. They are rendered only inside the authenticated
 * staff workspace; nothing here writes them to a log, a URL, or a Portal view.
 */

/** Permission that gates the create affordance (UX only; the API re-asserts it). */
export const CLINICAL_CREATE_PERMISSION = "vet.clinical.create";
/** Permission that gates the correct/clear affordances (UX only). */
export const CLINICAL_CORRECT_PERMISSION = "vet.clinical.update";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formats an instant as a `datetime-local` input value in this browser's clock.
 *
 * The same clock is used for display and for entry, so what staff type is what
 * they see. The value that leaves the browser is always an ISO instant, never a
 * date-only string: a hand-rolled "midnight UTC" would make the due report
 * bucket the row to the previous local day.
 */
export function toLocalInput(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-${pad2(
    instant.getDate()
  )}T${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`;
}

/**
 * Converts a `datetime-local` value to an ISO instant, or `null` when the field
 * is empty (or carries something the Date parser rejects). `null` is the only
 * "no value" the callers accept: an empty string is never sent to the API.
 */
export function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const instant = new Date(trimmed);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** Renders an instant for reading: the local date and minute, no seconds. */
export function formatRecordedInstant(iso: string): string {
  const localInput = toLocalInput(iso);
  return localInput === "" ? "" : localInput.replace("T", " ");
}

/** The fields both record kinds share; the adapters below name their own. */
interface ClinicalRecordView {
  readonly id: string;
  readonly name: string;
  readonly administeredAt: string;
  readonly nextDueAt: string | null;
}

/** A new record. `nextDueAt` is omitted when staff entered no due date. */
interface ClinicalRecordDraft {
  readonly name: string;
  readonly administeredAt: string;
  readonly nextDueAt?: string;
}

/**
 * A correction. Any subset is allowed and an absent key leaves the stored value
 * untouched; `nextDueAt: null` is the explicit removal.
 */
interface ClinicalRecordChange {
  readonly name?: string;
  readonly administeredAt?: string;
  readonly nextDueAt?: string | null;
}

/**
 * One record kind's wiring. Both kinds behave identically, so the section is
 * written once and parameterized by this description rather than duplicated.
 */
interface ClinicalRecordKind {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly nameLabel: string;
  readonly dueLabel: string;
  readonly createLabel: string;
  readonly createTitle: string;
  readonly saveLabel: string;
  readonly correctTitle: string;
  readonly loadingMessage: string;
  readonly emptyMessage: string;
  readonly createdNotice: string;
  readonly correctedNotice: string;
  readonly queryKey: (patientId: string) => readonly [string, string, string];
  readonly list: (patientId: string) => Promise<ClinicalRecordView[]>;
  readonly create: (patientId: string, draft: ClinicalRecordDraft) => Promise<ClinicalRecordView>;
  readonly correct: (
    patientId: string,
    id: string,
    change: ClinicalRecordChange
  ) => Promise<ClinicalRecordView>;
}

function toVaccinationView(record: ClinicalVaccination): ClinicalRecordView {
  return {
    id: record.id,
    name: record.vaccine,
    administeredAt: record.administeredAt,
    nextDueAt: record.nextDueAt,
  };
}

function toDewormingView(record: ClinicalDeworming): ClinicalRecordView {
  return {
    id: record.id,
    name: record.product,
    administeredAt: record.administeredAt,
    nextDueAt: record.nextDueAt,
  };
}

const VACCINATION_KIND: ClinicalRecordKind = {
  slug: "vaccination",
  title: "Vaccinations",
  description: "Each dose, when it was administered, and when the next one is due.",
  nameLabel: "Vaccine",
  dueLabel: "Next dose due (optional)",
  createLabel: "Record vaccination",
  createTitle: "New vaccination",
  saveLabel: "Save vaccination",
  correctTitle: "Correct vaccination",
  loadingMessage: "Loading vaccinations...",
  emptyMessage: "No vaccinations recorded for this patient yet.",
  createdNotice: "Vaccination recorded.",
  correctedNotice: "Vaccination corrected.",
  queryKey: (patientId) => ["clinical", patientId, "vaccinations"] as const,
  list: async (patientId) => (await listVaccinations(patientId)).map(toVaccinationView),
  create: async (patientId, draft) => {
    const body: CreateVaccinationInput = {
      vaccine: draft.name,
      administeredAt: draft.administeredAt,
      ...(draft.nextDueAt === undefined ? {} : { nextDueAt: draft.nextDueAt }),
    };
    return toVaccinationView(await createVaccination(patientId, body));
  },
  correct: async (patientId, id, change) => {
    const body: UpdateVaccinationInput = {
      ...(change.name === undefined ? {} : { vaccine: change.name }),
      ...(change.administeredAt === undefined ? {} : { administeredAt: change.administeredAt }),
      ...(change.nextDueAt === undefined ? {} : { nextDueAt: change.nextDueAt }),
    };
    return toVaccinationView(await updateVaccination(patientId, id, body));
  },
};

const DEWORMING_KIND: ClinicalRecordKind = {
  slug: "deworming",
  title: "Deworming treatments",
  description: "Each treatment, when it was administered, and when the next one is due.",
  nameLabel: "Product",
  dueLabel: "Next treatment due (optional)",
  createLabel: "Record deworming",
  createTitle: "New deworming treatment",
  saveLabel: "Save deworming",
  correctTitle: "Correct deworming treatment",
  loadingMessage: "Loading deworming treatments...",
  emptyMessage: "No deworming treatments recorded for this patient yet.",
  createdNotice: "Deworming treatment recorded.",
  correctedNotice: "Deworming treatment corrected.",
  queryKey: (patientId) => ["clinical", patientId, "deworming"] as const,
  list: async (patientId) => (await listDeworming(patientId)).map(toDewormingView),
  create: async (patientId, draft) => {
    const body: CreateDewormingInput = {
      product: draft.name,
      administeredAt: draft.administeredAt,
      ...(draft.nextDueAt === undefined ? {} : { nextDueAt: draft.nextDueAt }),
    };
    return toDewormingView(await createDeworming(patientId, body));
  },
  correct: async (patientId, id, change) => {
    const body: UpdateDewormingInput = {
      ...(change.name === undefined ? {} : { product: change.name }),
      ...(change.administeredAt === undefined ? {} : { administeredAt: change.administeredAt }),
      ...(change.nextDueAt === undefined ? {} : { nextDueAt: change.nextDueAt }),
    };
    return toDewormingView(await updateDeworming(patientId, id, body));
  },
};

const fieldClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

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

/** Same `role="alert"` semantics and tokens as the encounter section's alert. */
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

/** A denial is a first-class state: neutral styling, never a "something broke". */
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

/** True when a mutation failed on an authorization or entitlement gate. */
function mutationDenied(error: Error | null | undefined): boolean {
  return error !== null && error !== undefined && isClinicalPermissionDenied(error);
}

function MutationAlert({ error }: { readonly error: Error | null }): JSX.Element | null {
  if (error === null) return null;
  return mutationDenied(error) ? (
    <PermissionDeniedAlert message={userFacingClinicalError(error)} />
  ) : (
    <ErrorAlert message={userFacingClinicalError(error)} />
  );
}

/**
 * `undefined` means this surface was not told the caller's claims, so the action
 * is shown and the API stays authoritative — the same convention the staff nav
 * uses for an unknown entitlement. An explicit list without the key hides it.
 */
function permissionGranted(permissions: readonly string[] | undefined, required: string): boolean {
  return permissions === undefined || permissions.includes(required);
}

/** Create form: a name, a required administered instant, an optional due instant. */
function RecordCreateForm({
  kind,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  readonly kind: ClinicalRecordKind;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly onCancel: () => void;
  readonly onSubmit: (draft: ClinicalRecordDraft) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [administeredAt, setAdministeredAt] = useState("");
  const [nextDueAt, setNextDueAt] = useState("");

  const administeredInstant = fromLocalInput(administeredAt);
  const dueInstant = fromLocalInput(nextDueAt);
  const dueIsInvalid = nextDueAt.trim().length > 0 && dueInstant === null;
  const canSubmit =
    !pending && name.trim().length > 0 && administeredInstant !== null && !dueIsInvalid;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit || administeredInstant === null) return;
    onSubmit({
      name: name.trim(),
      administeredAt: administeredInstant,
      // Empty due field: the key is OMITTED, which the API reads as "no due
      // date recorded". The create schema rejects an explicit null; only an
      // update accepts one, because that is how a wrong date is removed.
      ...(dueInstant === null ? {} : { nextDueAt: dueInstant }),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border bg-card p-4">
      <p className="text-sm font-medium">{kind.createTitle}</p>
      <MutationAlert error={error} />
      <div className="space-y-2">
        <label htmlFor={`${kind.slug}-name`} className="text-sm font-medium">
          {kind.nameLabel}
        </label>
        <input
          id={`${kind.slug}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${kind.slug}-administered-at`} className="text-sm font-medium">
          Administered at
        </label>
        <input
          id={`${kind.slug}-administered-at`}
          type="datetime-local"
          value={administeredAt}
          onChange={(event) => setAdministeredAt(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${kind.slug}-due-at`} className="text-sm font-medium">
          {kind.dueLabel}
        </label>
        <input
          id={`${kind.slug}-due-at`}
          type="datetime-local"
          value={nextDueAt}
          onChange={(event) => setNextDueAt(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty when no due date was recorded. The due reports only read the dates staff
          enter.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? "Saving..." : kind.saveLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Per-row correction. Saving sends the fields the form owns; clearing sends
 * exactly `{ nextDueAt: null }` and nothing else, so removing a wrong date never
 * rewrites the name or the administration instant.
 */
function RecordCorrectionForm({
  kind,
  record,
  pending,
  error,
  onCancel,
  onSubmit,
  onClearDueDate,
}: {
  readonly kind: ClinicalRecordKind;
  readonly record: ClinicalRecordView;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly onCancel: () => void;
  readonly onSubmit: (change: ClinicalRecordChange) => void;
  readonly onClearDueDate: () => void;
}): JSX.Element {
  const [name, setName] = useState(record.name);
  const [administeredAt, setAdministeredAt] = useState(() => toLocalInput(record.administeredAt));
  const [nextDueAt, setNextDueAt] = useState(() =>
    record.nextDueAt === null ? "" : toLocalInput(record.nextDueAt)
  );

  const administeredInstant = fromLocalInput(administeredAt);
  const dueInstant = fromLocalInput(nextDueAt);
  const dueIsInvalid = nextDueAt.trim().length > 0 && dueInstant === null;
  const canSubmit =
    !pending && name.trim().length > 0 && administeredInstant !== null && !dueIsInvalid;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit || administeredInstant === null) return;
    onSubmit({
      name: name.trim(),
      administeredAt: administeredInstant,
      // An emptied due field means "no due date": null clears it. The separate
      // "Clear due date" control is the one-click path to the same write.
      nextDueAt: dueInstant,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-md border bg-background p-4">
      <p className="text-sm font-medium">{kind.correctTitle}</p>
      <MutationAlert error={error} />
      <div className="space-y-2">
        <label htmlFor={`${kind.slug}-correct-name`} className="text-sm font-medium">
          {kind.nameLabel}
        </label>
        <input
          id={`${kind.slug}-correct-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${kind.slug}-correct-administered-at`} className="text-sm font-medium">
          Administered at
        </label>
        <input
          id={`${kind.slug}-correct-administered-at`}
          type="datetime-local"
          value={administeredAt}
          onChange={(event) => setAdministeredAt(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${kind.slug}-correct-due-at`} className="text-sm font-medium">
          {kind.dueLabel}
        </label>
        <input
          id={`${kind.slug}-correct-due-at`}
          type="datetime-local"
          value={nextDueAt}
          onChange={(event) => setNextDueAt(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
        {record.nextDueAt !== null && (
          <Button type="button" variant="outline" onClick={onClearDueDate} disabled={pending}>
            Clear due date
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One record kind: its list, its create affordance and its per-row correction. */
function RecordKindPanel({
  patientId,
  kind,
  permissions,
}: {
  readonly patientId: string;
  readonly kind: ClinicalRecordKind;
  readonly permissions?: readonly string[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const queryKey = kind.queryKey(patientId);
  const [creating, setCreating] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const records = useQuery({ queryKey, queryFn: () => kind.list(patientId) });
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const createMutation = useMutation({
    mutationFn: (draft: ClinicalRecordDraft) => kind.create(patientId, draft),
    onSuccess: () => {
      setCreating(false);
      setNotice(kind.createdNotice);
      invalidate();
    },
  });

  const correctMutation = useMutation({
    mutationFn: (input: { readonly id: string; readonly change: ClinicalRecordChange }) =>
      kind.correct(patientId, input.id, input.change),
    onSuccess: () => {
      setCorrectingId(null);
      setNotice(kind.correctedNotice);
      invalidate();
    },
  });

  // Clearing is its own mutation so its notice can say what happened and so the
  // write is exactly `{ nextDueAt: null }` — nothing else is resubmitted.
  const clearMutation = useMutation({
    mutationFn: (id: string) => kind.correct(patientId, id, { nextDueAt: null }),
    onSuccess: () => {
      setCorrectingId(null);
      setNotice("Due date removed.");
      invalidate();
    },
  });

  const canCreate =
    permissionGranted(permissions, CLINICAL_CREATE_PERMISSION) &&
    !mutationDenied(createMutation.error);
  const canCorrect = permissionGranted(permissions, CLINICAL_CORRECT_PERMISSION);
  const pending = createMutation.isPending || correctMutation.isPending || clearMutation.isPending;
  const data = records.data;

  return (
    <section data-testid={`${kind.slug}-records`} className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{kind.title}</p>
        <p className="text-xs text-muted-foreground">{kind.description}</p>
      </div>

      {notice && (
        <p role="status" aria-live="polite" className="text-sm text-status-success">
          {notice}
        </p>
      )}

      {records.isLoading ? (
        <p className="text-sm text-muted-foreground">{kind.loadingMessage}</p>
      ) : records.error ? (
        <MutationAlert error={records.error} />
      ) : (
        <>
          {canCreate &&
            (creating ? (
              <RecordCreateForm
                kind={kind}
                pending={pending}
                error={createMutation.error}
                onCancel={() => {
                  createMutation.reset();
                  setCreating(false);
                }}
                onSubmit={(draft) => createMutation.mutate(draft)}
              />
            ) : (
              <Button type="button" onClick={() => setCreating(true)}>
                {kind.createLabel}
              </Button>
            ))}
          {!canCreate && createMutation.error && <MutationAlert error={createMutation.error} />}

          {data && data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{kind.emptyMessage}</p>
          ) : (
            <ul className="space-y-2">
              {data?.map((record) => (
                <li key={record.id} className="rounded-md border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{record.name}</span>
                    {canCorrect && correctingId !== record.id && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCorrectingId(record.id)}
                      >
                        Correct
                      </Button>
                    )}
                  </div>
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex gap-1">
                      <dt className="font-medium">Administered</dt>
                      <dd>{formatRecordedInstant(record.administeredAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="font-medium">Next due</dt>
                      <dd>
                        {record.nextDueAt === null
                          ? "No due date recorded"
                          : formatRecordedInstant(record.nextDueAt)}
                      </dd>
                    </div>
                  </dl>
                  {canCorrect && correctingId === record.id && (
                    <RecordCorrectionForm
                      kind={kind}
                      record={record}
                      pending={pending}
                      error={correctMutation.error ?? clearMutation.error}
                      onCancel={() => {
                        correctMutation.reset();
                        clearMutation.reset();
                        setCorrectingId(null);
                      }}
                      onSubmit={(change) => correctMutation.mutate({ id: record.id, change })}
                      onClearDueDate={() => clearMutation.mutate(record.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Staff entry surface for the two clinical record kinds that carry a due date.
 *
 * Rendered as an additional card inside the existing patient workspace; it does
 * not read, mutate or restructure the encounter section. Tenant identity,
 * permissions and the `veterinary` entitlement are enforced by the API — the
 * hidden/denied affordances here are UX only.
 */
export function ClinicalRecordsSection({
  patientId,
  permissions,
}: {
  readonly patientId: string;
  /**
   * The caller's permission keys when the shell knows them. `undefined` means
   * unknown, which keeps the affordances visible and leaves the API as the
   * authority; an explicit list without `vet.clinical.create` hides create.
   */
  readonly permissions?: readonly string[];
}): JSX.Element {
  return (
    <SectionCard
      title="Vaccinations and deworming"
      description="Record a dose or a treatment and the date it is next due. A due date can be corrected, and can be removed when it was recorded by mistake."
    >
      <RecordKindPanel patientId={patientId} kind={VACCINATION_KIND} permissions={permissions} />
      <RecordKindPanel patientId={patientId} kind={DEWORMING_KIND} permissions={permissions} />
    </SectionCard>
  );
}
