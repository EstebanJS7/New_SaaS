"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { formatEsPyDateOnly } from "@/lib/es-py-format";
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
 * 3. **This surface computes nothing.** Every instant comes from the API, and the
 *    only value it constructs is the wire form of a calendar date staff picked in
 *    `<input type="date">`: noon UTC of that date (see {@link fromDateInput} for
 *    why noon, and why the browser's clock is deliberately not consulted). That is
 *    what makes the due reports bucket the row to the day the veterinarian chose
 *    even when the browser's zone is not the tenant's.
 *
 * Data classification: the vaccine/product name and both instants are
 * CONFIDENTIAL clinical data. They are rendered only inside the authenticated
 * staff workspace; nothing here writes them to a log, a URL, or a Portal view.
 */

/** Length of a `YYYY-MM-DD` calendar date prefix. */
const DATE_PREFIX_LENGTH = 10;

/** A whole calendar date, the only shape the date fields accept. */
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Month lengths for a non-leap year; February is decided by the leap rule. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * True for a date the Gregorian calendar actually has.
 *
 * The shape check alone is not enough: `2026-13-01` and `2026-02-30` both match
 * `\d{4}-\d{2}-\d{2}` and would otherwise be pinned to a noon-UTC instant for a
 * day that does not exist, which the API would then store and the due report would
 * classify.
 */
function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const length = month === 2 && isLeapYear ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= length;
}

/**
 * The time-of-day this surface pins a calendar date to on the wire: **noon UTC**.
 * Twelve hours of margin either side is what keeps the tenant-local calendar date
 * equal to the date staff typed, whatever the tenant's offset.
 */
const DUE_INSTANT_TIME_PART = "12:00:00.000";

/** Permission that gates the create affordance (UX only; the API re-asserts it). */
export const CLINICAL_CREATE_PERMISSION = "vet.clinical.create";
/** Permission that gates the correct/clear affordances (UX only). */
export const CLINICAL_CORRECT_PERMISSION = "vet.clinical.update";

/**
 * Formats a stored instant as a `date` input value.
 *
 * The wire form this surface WRITES is noon UTC of the chosen calendar date (see
 * {@link fromDateInput}), so taking the first ten characters of the stored value
 * recovers exactly the date the veterinarian picked. It deliberately does not run
 * the instant through `new Date(...)` and reformat in the browser's clock: that
 * is what produced the defect this helper replaced.
 */
export function toDateInput(iso: string): string {
  return iso.slice(0, DATE_PREFIX_LENGTH);
}

/**
 * Converts a `date` input value to the instant this surface stores, or `null`
 * when the field is empty or does not carry a whole calendar date.
 *
 * **Why noon UTC and not midnight.** The due reports classify a row by its
 * CALENDAR DATE in the tenant's zone (`America/Asuncion`, `-03`), never by an
 * instant. Midnight UTC lands at 21:00 of the PREVIOUS tenant day, so "due
 * 2026-11-18" would be reported as due the 17th — one day early, silently. Noon
 * UTC has twelve hours of margin on both sides, so the tenant-local calendar date
 * equals the date staff typed for any tenant offset in `(-12, +12)`, which covers
 * Asunción and every realistic deployment.
 *
 * **Why this is browser-zone independent.** The previous implementation parsed a
 * `datetime-local` value with `new Date(...)`, which uses the BROWSER's clock. A
 * staff member (or a CI run) in a different zone from the tenant then stored an
 * instant whose tenant-local date was the day before, and the row was reported as
 * overdue a day early. Taking a plain calendar date and pinning it to noon UTC
 * removes the browser's clock from the conversion entirely.
 *
 * An empty field is `null` — the only "no value" the callers accept. A partial or
 * malformed value is also `null`, so nothing unparseable reaches the API.
 */
export function fromDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!isCalendarDate(trimmed)) return null;
  return `${trimmed}T${DUE_INSTANT_TIME_PART}Z`;
}

/** Renders a stored instant for reading: the calendar date staff chose. */
export function formatRecordedDate(iso: string): string {
  return formatEsPyDateOnly(toDateInput(iso));
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

/** Shared cache projection for the records panel and patient overview. */
export async function listVaccinationViews(patientId: string): Promise<ClinicalRecordView[]> {
  return (await listVaccinations(patientId)).map(toVaccinationView);
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
  title: "Vacunas",
  description: "Dosis aplicadas, fecha de aplicación y próxima fecha indicada.",
  nameLabel: "Vacuna",
  dueLabel: "Próxima dosis (opcional)",
  createLabel: "Registrar vacuna",
  createTitle: "Nueva vacuna",
  saveLabel: "Guardar vacuna",
  correctTitle: "Corregir vacuna",
  loadingMessage: "Cargando vacunas…",
  emptyMessage: "Este paciente todavía no tiene vacunas registradas.",
  createdNotice: "Vacuna registrada.",
  correctedNotice: "Vacuna corregida.",
  queryKey: (patientId) => ["clinical", patientId, "vaccinations"] as const,
  list: listVaccinationViews,
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
  title: "Desparasitaciones",
  description: "Tratamientos aplicados, fecha de aplicación y próxima fecha indicada.",
  nameLabel: "Producto",
  dueLabel: "Próxima desparasitación (opcional)",
  createLabel: "Registrar desparasitación",
  createTitle: "Nueva desparasitación",
  saveLabel: "Guardar desparasitación",
  correctTitle: "Corregir desparasitación",
  loadingMessage: "Cargando desparasitaciones…",
  emptyMessage: "Este paciente todavía no tiene desparasitaciones registradas.",
  createdNotice: "Desparasitación registrada.",
  correctedNotice: "Desparasitación corregida.",
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

  const administeredInstant = fromDateInput(administeredAt);
  const dueInstant = fromDateInput(nextDueAt);
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
          Administered on
        </label>
        <input
          id={`${kind.slug}-administered-at`}
          type="date"
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
          type="date"
          value={nextDueAt}
          onChange={(event) => setNextDueAt(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
        <p className="text-xs text-muted-foreground">
          Dejá vacío si no se indicó una próxima fecha. Los informes muestran únicamente las fechas
          registradas por el equipo.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? "Guardando…" : kind.saveLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancelar
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
  const [administeredAt, setAdministeredAt] = useState(() => toDateInput(record.administeredAt));
  const [nextDueAt, setNextDueAt] = useState(() =>
    record.nextDueAt === null ? "" : toDateInput(record.nextDueAt)
  );

  const administeredInstant = fromDateInput(administeredAt);
  const dueInstant = fromDateInput(nextDueAt);
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
          Fecha de aplicación
        </label>
        <input
          id={`${kind.slug}-correct-administered-at`}
          type="date"
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
          type="date"
          value={nextDueAt}
          onChange={(event) => setNextDueAt(event.target.value)}
          disabled={pending}
          className={fieldClassName}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !canSubmit}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        {record.nextDueAt !== null && (
          <Button type="button" variant="outline" onClick={onClearDueDate} disabled={pending}>
            Quitar próxima fecha
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
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
      setNotice("Próxima fecha quitada.");
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
                        Corregir
                      </Button>
                    )}
                  </div>
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex gap-1">
                      <dt className="font-medium">Aplicada</dt>
                      <dd>{formatRecordedDate(record.administeredAt)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="font-medium">Próxima fecha</dt>
                      <dd>
                        {record.nextDueAt === null
                          ? "Sin fecha indicada"
                          : formatRecordedDate(record.nextDueAt)}
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
      title="Vacunas y desparasitaciones"
      description="Registrá la aplicación o el tratamiento y, si corresponde, la próxima fecha. También podés corregirla o quitarla si fue ingresada por error."
    >
      <RecordKindPanel patientId={patientId} kind={VACCINATION_KIND} permissions={permissions} />
      <RecordKindPanel patientId={patientId} kind={DEWORMING_KIND} permissions={permissions} />
    </SectionCard>
  );
}
