"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import { ErrorState, ListSkeleton } from "@/components/feedback";
import { listAppointmentOptions, type AppointmentOptions } from "@/app/(app)/app/agenda/agenda-api";
import { isoToLocalInput, tryLocalInputToIso } from "@/app/(app)/app/agenda/agenda-time";
import {
  WEEKDAYS,
  blockError,
  formatBlockInstant,
  minuteToTime,
  minuteToTimeInput,
  parseScheduleLists,
  timeToMinute,
  weekdayLabel,
  windowError,
  type AvailabilityWindow,
  type ScheduleBlock,
} from "./availability-rules";
import { changedFields } from "./general-settings-rules";
import type { SectionFormProps } from "./settings-section";

const UNKNOWN_PROFESSIONAL = "Profesional no disponible";
const UNKNOWN_BRANCH = "Sucursal no disponible";
const SELECT_CLASS =
  "min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

/** Names of this clinic's professionals and branches, from the agenda's options read. */
interface Directory {
  readonly professionals: readonly { readonly id: string; readonly name: string }[];
  readonly branches: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
  }[];
  professionalName(id: string): string;
  branchName(id: string): string;
}

function directoryOf(options: AppointmentOptions): Directory {
  const professionals = options.professionals
    .map((professional) => {
      const name = professional.displayName?.trim() ?? "";
      return { id: professional.membershipId, name: name === "" ? "Profesional sin nombre" : name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  const branches = options.branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    active: branch.isActive !== false,
  }));
  return {
    professionals,
    branches,
    professionalName: (id) =>
      professionals.find((entry) => entry.id === id)?.name ?? UNKNOWN_PROFESSIONAL,
    branchName: (id) => {
      const branch = branches.find((entry) => entry.id === id);
      if (branch === undefined) return UNKNOWN_BRANCH;
      return branch.active ? branch.name : `${branch.name} (inactiva)`;
    },
  };
}

/** Professional and branch pickers; a value no longer listed stays selectable as is. */
function ProfessionalBranchFields({
  directory,
  membershipId,
  branchId,
  onChange,
}: {
  directory: Directory;
  membershipId: string;
  branchId: string;
  onChange: (next: { membershipId?: string; branchId?: string }) => void;
}): JSX.Element {
  const professionalId = useId();
  const branchFieldId = useId();
  const knownProfessional = directory.professionals.some((entry) => entry.id === membershipId);
  // Active branches take new rows; an inactive or unknown current value stays shown.
  const branchChoices = directory.branches.filter(
    (branch) => branch.active || branch.id === branchId
  );
  const knownBranch = branchChoices.some((branch) => branch.id === branchId);
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={professionalId} className="text-sm font-medium">
          Profesional
        </label>
        <select
          id={professionalId}
          className={SELECT_CLASS}
          value={membershipId}
          onChange={(event) => onChange({ membershipId: event.target.value })}
        >
          <option value="">Elegí un profesional</option>
          {membershipId !== "" && !knownProfessional ? (
            <option value={membershipId}>{UNKNOWN_PROFESSIONAL}</option>
          ) : null}
          {directory.professionals.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={branchFieldId} className="text-sm font-medium">
          Sucursal
        </label>
        <select
          id={branchFieldId}
          className={SELECT_CLASS}
          value={branchId}
          onChange={(event) => onChange({ branchId: event.target.value })}
        >
          <option value="">Elegí una sucursal</option>
          {branchId !== "" && !knownBranch ? (
            <option value={branchId}>{UNKNOWN_BRANCH}</option>
          ) : null}
          {branchChoices.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {directory.branchName(branch.id)}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function TimeField({
  label,
  value,
  hint,
  onChange,
  type,
}: {
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
  type: "time" | "datetime-local";
}): JSX.Element {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function RowActions({
  description,
  onEdit,
  onRemove,
}: {
  description: string;
  onEdit: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Editar ${description}`}
        onClick={onEdit}
      >
        Editar
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Quitar ${description}`}
        onClick={onRemove}
      >
        Quitar
      </Button>
    </div>
  );
}

function Subsection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-3 border-t border-border pt-4">
      <div className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

const TABLE_CLASS = "w-full text-left text-sm";
const HEAD_CLASS = "border-b border-border text-xs text-muted-foreground";
const CELL_CLASS = "py-2 pr-3 align-middle";

interface WindowDraft {
  readonly membershipId: string;
  readonly branchId: string;
  readonly weekday: string;
  readonly start: string;
  readonly end: string;
}

const EMPTY_WINDOW: WindowDraft = {
  membershipId: "",
  branchId: "",
  weekday: "1",
  start: "",
  end: "",
};

function WindowsEditor({
  directory,
  windows,
  onChange,
}: {
  directory: Directory;
  windows: readonly AvailabilityWindow[];
  onChange: (windows: AvailabilityWindow[]) => void;
}): JSX.Element {
  const weekdayId = useId();
  const [draft, setDraft] = useState<WindowDraft>(EMPTY_WINDOW);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setDraft(EMPTY_WINDOW);
    setEditing(null);
    setError(null);
  };
  const submit = (): void => {
    const startMinute = timeToMinute(draft.start, "start");
    const endMinute = timeToMinute(draft.end, "end");
    const refusal = windowError({ ...draft, startMinute, endMinute });
    if (refusal !== null || startMinute === null || endMinute === null) {
      setError(refusal);
      return;
    }
    const next: AvailabilityWindow = {
      membershipId: draft.membershipId,
      branchId: draft.branchId,
      weekday: Number(draft.weekday),
      startMinute,
      endMinute,
    };
    onChange(
      editing === null
        ? [...windows, next]
        : windows.map((window, index) => (index === editing ? next : window))
    );
    reset();
  };
  const describe = (window: AvailabilityWindow): string =>
    `el horario de ${directory.professionalName(window.membershipId)}, ${weekdayLabel(
      window.weekday
    )} de ${minuteToTime(window.startMinute)} a ${minuteToTime(window.endMinute)}`;

  return (
    <Subsection
      title="Horarios de atención"
      description="Días y horas en que cada profesional atiende en cada sucursal, en hora de la clínica. Un profesional sin horarios en una sucursal acepta turnos a cualquier hora."
    >
      {windows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin horarios: la agenda acepta turnos a cualquier hora.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead className={HEAD_CLASS}>
              <tr>
                <th className={CELL_CLASS}>Profesional</th>
                <th className={CELL_CLASS}>Sucursal</th>
                <th className={CELL_CLASS}>Día</th>
                <th className={CELL_CLASS}>Desde</th>
                <th className={CELL_CLASS}>Hasta</th>
                <th className={CELL_CLASS}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {windows.map((window, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  <td className={CELL_CLASS}>{directory.professionalName(window.membershipId)}</td>
                  <td className={CELL_CLASS}>{directory.branchName(window.branchId)}</td>
                  <td className={CELL_CLASS}>{weekdayLabel(window.weekday)}</td>
                  <td className={CELL_CLASS}>{minuteToTime(window.startMinute)}</td>
                  <td className={CELL_CLASS}>{minuteToTime(window.endMinute)}</td>
                  <td className={CELL_CLASS}>
                    <RowActions
                      description={describe(window)}
                      onEdit={() => {
                        setEditing(index);
                        setError(null);
                        setDraft({
                          membershipId: window.membershipId,
                          branchId: window.branchId,
                          weekday: String(window.weekday),
                          start: minuteToTimeInput(window.startMinute),
                          end: minuteToTimeInput(window.endMinute),
                        });
                      }}
                      onRemove={() => {
                        onChange(windows.filter((_, other) => other !== index));
                        reset();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">
          {editing === null ? "Nuevo horario" : "Editar horario"}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <ProfessionalBranchFields
            directory={directory}
            membershipId={draft.membershipId}
            branchId={draft.branchId}
            onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
          />
          <div className="space-y-1">
            <label htmlFor={weekdayId} className="text-sm font-medium">
              Día
            </label>
            <select
              id={weekdayId}
              className={SELECT_CLASS}
              value={draft.weekday}
              onChange={(event) =>
                setDraft((current) => ({ ...current, weekday: event.target.value }))
              }
            >
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={String(day.value)}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
          <TimeField
            type="time"
            label="Desde"
            value={draft.start}
            onChange={(start) => setDraft((current) => ({ ...current, start }))}
          />
          <TimeField
            type="time"
            label="Hasta"
            hint="00:00 es la medianoche al final del día."
            value={draft.end}
            onChange={(end) => setDraft((current) => ({ ...current, end }))}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={submit}>
            {editing === null ? "Agregar horario" : "Actualizar horario"}
          </Button>
          {editing !== null ? (
            <Button type="button" variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </fieldset>
    </Subsection>
  );
}

interface BlockDraft {
  readonly membershipId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string;
}

const EMPTY_BLOCK: BlockDraft = { membershipId: "", branchId: "", from: "", to: "" };

function BlocksEditor({
  directory,
  blocks,
  onChange,
}: {
  directory: Directory;
  blocks: readonly ScheduleBlock[];
  onChange: (blocks: ScheduleBlock[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<BlockDraft>(EMPTY_BLOCK);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setDraft(EMPTY_BLOCK);
    setEditing(null);
    setError(null);
  };
  const submit = (): void => {
    // Clinic wall clock → UTC instant, exactly as the agenda converts its inputs.
    const startsAt = tryLocalInputToIso(draft.from);
    const endsAt = tryLocalInputToIso(draft.to);
    const refusal = blockError({ ...draft, startsAt, endsAt });
    if (refusal !== null || startsAt === null || endsAt === null) {
      setError(refusal);
      return;
    }
    const next: ScheduleBlock = {
      membershipId: draft.membershipId,
      branchId: draft.branchId,
      startsAt,
      endsAt,
    };
    onChange(
      editing === null
        ? [...blocks, next]
        : blocks.map((block, index) => (index === editing ? next : block))
    );
    reset();
  };
  const describe = (block: ScheduleBlock): string =>
    `el bloqueo de ${directory.professionalName(block.membershipId)} desde ${formatBlockInstant(
      block.startsAt
    )} hasta ${formatBlockInstant(block.endsAt)}`;

  return (
    <Subsection
      title="Bloqueos"
      description="Períodos puntuales en que un profesional no toma turnos en una sucursal (vacaciones, capacitaciones), en hora de la clínica."
    >
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin bloqueos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead className={HEAD_CLASS}>
              <tr>
                <th className={CELL_CLASS}>Profesional</th>
                <th className={CELL_CLASS}>Sucursal</th>
                <th className={CELL_CLASS}>Desde</th>
                <th className={CELL_CLASS}>Hasta</th>
                <th className={CELL_CLASS}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  <td className={CELL_CLASS}>{directory.professionalName(block.membershipId)}</td>
                  <td className={CELL_CLASS}>{directory.branchName(block.branchId)}</td>
                  <td className={CELL_CLASS}>{formatBlockInstant(block.startsAt)}</td>
                  <td className={CELL_CLASS}>{formatBlockInstant(block.endsAt)}</td>
                  <td className={CELL_CLASS}>
                    <RowActions
                      description={describe(block)}
                      onEdit={() => {
                        setEditing(index);
                        setError(null);
                        setDraft({
                          membershipId: block.membershipId,
                          branchId: block.branchId,
                          from: isoToLocalInput(block.startsAt),
                          to: isoToLocalInput(block.endsAt),
                        });
                      }}
                      onRemove={() => {
                        onChange(blocks.filter((_, other) => other !== index));
                        reset();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">
          {editing === null ? "Nuevo bloqueo" : "Editar bloqueo"}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ProfessionalBranchFields
            directory={directory}
            membershipId={draft.membershipId}
            branchId={draft.branchId}
            onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
          />
          <TimeField
            type="datetime-local"
            label="Desde"
            value={draft.from}
            onChange={(from) => setDraft((current) => ({ ...current, from }))}
          />
          <TimeField
            type="datetime-local"
            label="Hasta"
            value={draft.to}
            onChange={(to) => setDraft((current) => ({ ...current, to }))}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={submit}>
            {editing === null ? "Agregar bloqueo" : "Actualizar bloqueo"}
          </Button>
          {editing !== null ? (
            <Button type="button" variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </fieldset>
    </Subsection>
  );
}

function ListsEditor({
  directory,
  stored,
  onSave,
  saving,
}: {
  directory: Directory;
  stored: { availability: AvailabilityWindow[]; blocks: ScheduleBlock[] };
  onSave: SectionFormProps["onSave"];
  saving: boolean;
}): JSX.Element {
  const [availability, setAvailability] = useState(stored.availability);
  const [blocks, setBlocks] = useState(stored.blocks);
  // Arrays are replaced whole by the API, so a changed list is sent complete;
  // an unchanged list and `conflictPolicy` are never sent.
  const patch = changedFields(stored, { availability, blocks });
  const dirty = Object.keys(patch).length > 0;
  return (
    <div className="space-y-4" aria-busy={saving}>
      <WindowsEditor directory={directory} windows={availability} onChange={setAvailability} />
      <BlocksEditor directory={directory} blocks={blocks} onChange={setBlocks} />
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="button"
          disabled={!dirty}
          loading={saving}
          onClick={() => dirty && onSave(patch)}
        >
          Guardar horarios y bloqueos
        </Button>
        {dirty ? (
          <p className="text-xs text-muted-foreground">
            Hay cambios sin guardar en horarios o bloqueos.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Agenda availability windows and blocks ([[CFG-001]] T2). Professionals and
 * branches come from the agenda's options read (`GET /appointments/options`,
 * `scheduling.appointment.read`): this clinic's VETERINARIAN memberships and
 * branches. Saving sends only `availability` and/or `blocks`, each complete.
 */
export function AvailabilityEditor({ settings, onSave, saving }: SectionFormProps): JSX.Element {
  const stored = parseScheduleLists(settings);
  const options = useQuery({
    queryKey: ["scheduling", "options"],
    queryFn: listAppointmentOptions,
    retry: false,
    enabled: stored !== null,
  });

  if (stored === null) {
    return (
      <p className="border-t border-border pt-4 text-sm text-muted-foreground">
        No se pudieron leer los horarios y bloqueos guardados. No se pueden editar desde acá.
      </p>
    );
  }
  if (options.isLoading) {
    return <ListSkeleton label="Cargando profesionales y sucursales…" rows={2} />;
  }
  if (options.error || !options.data) {
    return (
      <ErrorState
        message="No se pudieron cargar los profesionales y las sucursales."
        onRetry={() => void options.refetch()}
      />
    );
  }
  return (
    <ListsEditor
      directory={directoryOf(options.data)}
      stored={stored}
      onSave={onSave}
      saving={saving}
    />
  );
}
