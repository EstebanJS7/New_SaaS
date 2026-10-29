"use client";

import type { FormEvent, JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { Card, CardContent } from "@newsaas/ui/components/ui/card";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import Link from "next/link";
import {
  APPOINTMENT_STATUSES,
  allowedTransitions,
  approveBookingRequest,
  createAppointment,
  getAppointment,
  getSchedulingSettings,
  isAgendaConflict,
  isAgendaPermissionDenied,
  listAppointmentOptions,
  listAppointments,
  listBookingRequests,
  rejectBookingRequest,
  rescheduleAppointment,
  transitionAppointment,
  userFacingAgendaError,
  userFacingBookingRequestError,
  type Appointment,
  type AppointmentStatus,
  type ApproveBookingRequestInput,
  type BookingRequest,
  type CreateAppointmentInput,
  type TransitionCommand,
} from "./agenda-api";
import { listCatalogItems } from "../catalog/catalog-api";
import { AgendaViews, type AgendaView } from "./agenda-views";
import { PatientSelector } from "./patient-selector";
import { patientLookupError, usePatientIdentities } from "./patient-lookup";
import type { PatientIdentity } from "../patients/patients-api";
import { buildAvailabilityOverlay, type AvailabilityOverlay } from "./agenda-availability";
import {
  addDaysToKey,
  addMonthsToKey,
  dateKeyOf,
  formatDayHeading,
  formatTimeRange,
  isoToLocalInput,
  tryLocalInputToIso,
} from "./agenda-time";

function professionalDisplayLabel(membershipId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  return name !== undefined && name.length > 0
    ? name
    : `Profesional (ID) ${membershipId.slice(0, 8)}`;
}

const VIEWS: readonly { readonly id: AgendaView; readonly label: string }[] = [
  { id: "day", label: "Día" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "list", label: "Lista" },
];

const TRANSITION_LABELS: Readonly<Record<TransitionCommand, string>> = {
  confirm: "Confirmar turno",
  arrive: "Marcar llegada",
  start: "Iniciar atención",
  complete: "Completar atención",
  cancel: "Cancelar turno",
  "no-show": "Marcar inasistencia",
};

const APPOINTMENT_STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "Programado",
  CONFIRMED: "Confirmado",
  ARRIVED: "Llegó",
  IN_PROGRESS: "En atención",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  NO_SHOW: "No asistió",
};

const TRANSITION_CONFIRMATIONS: Readonly<
  Record<TransitionCommand, { readonly title: string; readonly description: string }>
> = {
  confirm: {
    title: "Confirmar este turno",
    description: "El turno quedará confirmado para la agenda.",
  },
  arrive: {
    title: "Registrar llegada",
    description: "Se actualizará el estado del turno para indicar que el paciente llegó.",
  },
  start: {
    title: "Iniciar la atención",
    description: "El turno pasará al estado de atención en curso.",
  },
  complete: {
    title: "Completar la atención",
    description: "El turno quedará registrado como completado.",
  },
  cancel: {
    title: "Cancelar este turno",
    description: "El turno quedará cancelado. Esta acción se registra en la agenda.",
  },
  "no-show": {
    title: "Registrar inasistencia",
    description: "El turno quedará marcado como inasistencia.",
  },
};

const controlClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const fieldClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function isInvalidLocalDateTime(value: string): boolean {
  return tryLocalInputToIso(value) === null;
}

/**
 * The agenda's own narrow view of a catalog SERVICE item: id and name only.
 * Projecting here (instead of passing the full `CatalogItem`) keeps price, tax,
 * rate and currency structurally out of the selector and the agenda filter.
 */
interface ServiceOption {
  readonly id: string;
  readonly name: string;
}

/**
 * Copy for the service-option read's degradation state.
 *
 * The catalog read is a convenience and the appointment reference is OPTIONAL,
 * so a failed read must neither break the page nor invent a permission rule:
 * the selectors stay empty and saving the appointment without a service keeps
 * working. The client is never the authorization authority.
 */
const SERVICE_OPTIONS_UNAVAILABLE =
  "No se pudo cargar la lista de servicios. Podés guardar el turno sin asociar uno.";

/**
 * Offers the linked service even when it is absent from the active list.
 *
 * A link created before the item was deactivated still renders its identity on
 * reads, so the edit surface must show it as the current selection; dropping it
 * would silently turn "keep the link" into "clear the link".
 */
function serviceOptionsFor(
  services: readonly ServiceOption[],
  appointment: Appointment
): readonly ServiceOption[] {
  const linked = appointment.service;
  if (linked === null || services.some((service) => service.id === linked.id)) {
    return services;
  }
  return [{ id: linked.id, name: linked.name }, ...services];
}

/**
 * Copy for the availability overlay's two non-happy states.
 *
 * The hint is shown when no concrete (branch, professional) pair is selected,
 * so there is nothing honest to shade. The warning is shown when a pair IS
 * selected but the settings read failed or returned a malformed namespace:
 * the pair's hours are unknown, and "nothing shaded" must never be read as the
 * unrestricted pair the write path actually accepts.
 */
const AVAILABILITY_HINT =
  "Elegí una sucursal y un profesional para ver sus horarios y bloqueos en el calendario.";
const AVAILABILITY_UNAVAILABLE =
  "No se pudo cargar la disponibilidad. El calendario podría mostrar horarios fuera de la jornada del profesional.";

type EditorState =
  | { readonly kind: "create"; readonly startAt?: string; readonly endAt?: string }
  | { readonly kind: "manage"; readonly appointment: Appointment }
  | { readonly kind: "request"; readonly request: BookingRequest }
  | null;

/** Create form: anchors plus a tenant wall-clock start/end range. */
function CreateAppointmentForm({
  branches,
  professionals,
  services,
  isPending,
  error,
  initialStartAt,
  initialEndAt,
  onSubmit,
  onClose,
}: {
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly professionals: readonly {
    readonly membershipId: string;
    readonly displayName?: string | null;
  }[];
  readonly services: readonly ServiceOption[];
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly initialStartAt?: string;
  readonly initialEndAt?: string;
  readonly onSubmit: (input: CreateAppointmentInput) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [professionalMembershipId, setProfessionalMembershipId] = useState(
    professionals[0]?.membershipId ?? ""
  );
  const [patient, setPatient] = useState<PatientIdentity | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [startAt, setStartAt] = useState(() =>
    initialStartAt !== undefined ? isoToLocalInput(initialStartAt) : ""
  );
  const [endAt, setEndAt] = useState(() =>
    initialEndAt !== undefined ? isoToLocalInput(initialEndAt) : ""
  );
  const [validation, setValidation] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const startIso = tryLocalInputToIso(startAt);
    const endIso = tryLocalInputToIso(endAt);
    if (branchId === "" || professionalMembershipId === "" || patient === null) {
      setValidation(
        "Elegí una sucursal, un profesional y un paciente de los resultados de búsqueda."
      );
      const form = event.currentTarget;
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    if (startIso === null || endIso === null || Date.parse(endIso) <= Date.parse(startIso)) {
      setValidation("Revisá la fecha y la hora: el final debe ser posterior al inicio.");
      const form = event.currentTarget;
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    setValidation(null);
    onSubmit({
      branchId,
      patientId: patient.id,
      professionalMembershipId,
      startAt: startIso,
      endAt: endIso,
      // The service is OPTIONAL and is deliberately NOT part of the range: the
      // start/end span is the explicit user input and the service never derives
      // or overwrites it. An empty selection sends no key at all.
      ...(serviceId !== "" && { serviceId }),
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Nuevo turno</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </div>
        <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              Sucursal <span aria-hidden="true">*</span>
            </span>
            <select
              aria-label="Sucursal"
              required
              aria-invalid={validation !== null && branchId === ""}
              aria-describedby={
                validation !== null && branchId === "" ? "appointment-validation" : undefined
              }
              className={fieldClassName}
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              <option value="">Elegí una sucursal</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              Profesional <span aria-hidden="true">*</span>
            </span>
            <select
              aria-label="Profesional"
              required
              aria-invalid={validation !== null && professionalMembershipId === ""}
              aria-describedby={
                validation !== null && professionalMembershipId === ""
                  ? "appointment-validation"
                  : undefined
              }
              className={fieldClassName}
              value={professionalMembershipId}
              onChange={(event) => setProfessionalMembershipId(event.target.value)}
            >
              <option value="">Elegí un profesional</option>
              {professionals.map((professional) => (
                <option key={professional.membershipId} value={professional.membershipId}>
                  {professionalDisplayLabel(professional.membershipId, professional.displayName)}
                </option>
              ))}
            </select>
          </label>
          <PatientSelector
            value={patient}
            onChange={setPatient}
            disabled={isPending}
            invalid={validation !== null && patient === null}
          />
          <label className="space-y-1 text-sm">
            <span className="font-medium">Servicio (opcional)</span>
            <select
              aria-label="Servicio"
              className={fieldClassName}
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">Sin servicio</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              Inicio <span aria-hidden="true">*</span>
            </span>
            <input
              type="datetime-local"
              aria-label="Inicio"
              className={fieldClassName}
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
              aria-invalid={
                validation !== null && (isInvalidLocalDateTime(startAt) || startAt === "")
              }
              aria-describedby={validation !== null ? "appointment-validation" : undefined}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              Fin <span aria-hidden="true">*</span>
            </span>
            <input
              type="datetime-local"
              aria-label="Fin"
              className={fieldClassName}
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
              aria-invalid={
                validation !== null &&
                (isInvalidLocalDateTime(endAt) || endAt === "" || startAt === "")
              }
              aria-describedby={validation !== null ? "appointment-validation" : undefined}
            />
          </label>
          <div className="sm:col-span-2">
            {validation !== null && (
              <p id="appointment-validation" role="alert" className="mb-2 text-sm text-destructive">
                {validation}
              </p>
            )}
            {error !== null && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {userFacingAgendaError(error)}
              </p>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando turno…" : "Crear turno"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Manage panel: version-guarded reschedule plus the legal lifecycle commands. */
function ManageAppointmentForm({
  appointment,
  patientName,
  services,
  isPending,
  error,
  onReschedule,
  onTransition,
  onClose,
}: {
  readonly appointment: Appointment;
  readonly patientName: string;
  readonly services: readonly ServiceOption[];
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onReschedule: (startIso: string, endIso: string, serviceId: string | null) => void;
  readonly onTransition: (command: TransitionCommand) => void | Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const [startAt, setStartAt] = useState(() => isoToLocalInput(appointment.startAt));
  const [endAt, setEndAt] = useState(() => isoToLocalInput(appointment.endAt));
  const [serviceId, setServiceId] = useState(() => appointment.serviceId ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const [transitionToConfirm, setTransitionToConfirm] = useState<TransitionCommand | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const startIso = tryLocalInputToIso(startAt);
    const endIso = tryLocalInputToIso(endAt);
    if (startIso === null || endIso === null || Date.parse(endIso) <= Date.parse(startIso)) {
      setValidation("Revisá la fecha y la hora: el final debe ser posterior al inicio.");
      const form = event.currentTarget;
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    setValidation(null);
    // An empty selection is an explicit `null`, which CLEARS the stored link; a
    // selection keeps or sets it. The start/end span stays the explicit user
    // input, so the service never derives or overwrites the appointment range.
    onReschedule(startIso, endIso, serviceId === "" ? null : serviceId);
  }

  const transitions = allowedTransitions(appointment.status);
  const serviceOptions = serviceOptionsFor(services, appointment);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Gestionar turno</h2>
            <p className="text-xs text-muted-foreground">
              {formatDayHeading(dateKeyOf(appointment.startAt))} ·{" "}
              {formatTimeRange(appointment.startAt, appointment.endAt)}
              {/* Name only: no price, tax, rate or currency on the agenda. */}
              {appointment.service !== null && (
                <span data-testid="manage-appointment-service">
                  {" "}
                  · Servicio: {appointment.service.name}
                </span>
              )}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Inicio</span>
            <input
              type="datetime-local"
              aria-label="Inicio"
              className={fieldClassName}
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
              aria-invalid={
                validation !== null && (startAt === "" || isInvalidLocalDateTime(startAt))
              }
              aria-describedby={validation !== null ? "reschedule-validation" : undefined}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Fin</span>
            <input
              type="datetime-local"
              aria-label="Fin"
              className={fieldClassName}
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
              aria-invalid={
                validation !== null &&
                (endAt === "" || isInvalidLocalDateTime(endAt) || startAt === "")
              }
              aria-describedby={validation !== null ? "reschedule-validation" : undefined}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Servicio (opcional)</span>
            <select
              aria-label="Servicio"
              className={fieldClassName}
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">Sin servicio</option>
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <div aria-hidden className="hidden sm:block" />
          <div className="sm:col-span-2">
            {validation !== null && (
              <p id="reschedule-validation" role="alert" className="mb-2 text-sm text-destructive">
                {validation}
              </p>
            )}
            {error !== null && transitionToConfirm === null && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {userFacingAgendaError(error)}
              </p>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </form>
        {transitions.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Estado del turno</p>
            <div className="flex flex-wrap gap-2">
              {transitions.map((command) => (
                <Button
                  key={command}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setTransitionToConfirm(command)}
                >
                  {TRANSITION_LABELS[command]}
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href={`/app/patients/${appointment.patientId}?appointment=${appointment.id}#patient-clinical`}
          >
            Abrir ficha de {patientName}
          </Link>
        </p>
      </CardContent>
      <ConfirmActionDialog
        open={transitionToConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setTransitionToConfirm(null);
        }}
        title={
          transitionToConfirm === null
            ? "Actualizar turno"
            : TRANSITION_CONFIRMATIONS[transitionToConfirm].title
        }
        description={
          transitionToConfirm === null
            ? ""
            : TRANSITION_CONFIRMATIONS[transitionToConfirm].description
        }
        confirmLabel={
          transitionToConfirm === null ? "Confirmar" : TRANSITION_LABELS[transitionToConfirm]
        }
        confirmVariant={
          transitionToConfirm === "cancel" || transitionToConfirm === "no-show"
            ? "destructive"
            : "default"
        }
        pending={isPending}
        pendingLabel="Actualizando…"
        errorMessage={error === null ? undefined : userFacingAgendaError(error)}
        onConfirm={async () => {
          if (transitionToConfirm === null) return;
          await onTransition(transitionToConfirm);
        }}
      />
    </Card>
  );
}

/**
 * Decision panel for one PENDING booking request. Approve and reject are both
 * reachable here, so the request can be decided from the agenda where it is
 * visible. Approve needs a branch and a professional that the request does not
 * carry, so the selects reuse the agenda's appointment options; the slot
 * override is optional and all-or-nothing (both overrides or neither). Reject
 * needs nothing. A failed decision leaves the panel open — the request stays
 * pending rather than reading as decided.
 */
function BookingRequestDecisionForm({
  request,
  patientName,
  branches,
  professionals,
  isPending,
  error,
  onApprove,
  onReject,
  onClose,
}: {
  readonly request: BookingRequest;
  readonly patientName: string;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly professionals: readonly {
    readonly membershipId: string;
    readonly displayName?: string | null;
  }[];
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onApprove: (input: ApproveBookingRequestInput) => void | Promise<void>;
  readonly onReject: () => void | Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [professionalMembershipId, setProfessionalMembershipId] = useState(
    professionals[0]?.membershipId ?? ""
  );
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const overrideValidation = validation?.includes("horario") ?? false;

  function handleApprove(): void {
    if (branchId === "" || professionalMembershipId === "") {
      setValidation("Elegí una sucursal y un profesional para aprobar la solicitud.");
      return;
    }
    const hasStart = startAt !== "";
    const hasEnd = endAt !== "";
    if (hasStart !== hasEnd) {
      setValidation("Ingresá los dos horarios alternativos o dejalos vacíos.");
      return;
    }
    if (hasStart && hasEnd) {
      const startIso = tryLocalInputToIso(startAt);
      const endIso = tryLocalInputToIso(endAt);
      if (startIso === null || endIso === null || Date.parse(endIso) <= Date.parse(startIso)) {
        setValidation("Revisá los horarios: el final debe ser posterior al inicio.");
        return;
      }
      setValidation(null);
      setDecision("approve");
      return;
    }
    setValidation(null);
    setDecision("approve");
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Solicitud de turno pendiente</h2>
            <p className="text-xs text-muted-foreground">
              {formatDayHeading(dateKeyOf(request.startAt))} ·{" "}
              {formatTimeRange(request.startAt, request.endAt)} · {patientName}
            </p>
            <Link
              className="text-xs text-primary underline-offset-4 hover:underline"
              href={`/app/patients/${request.patientId}`}
            >
              Abrir ficha del paciente
            </Link>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          La solicitud no reserva el horario. Al aprobarla se crea el turno; seguirá pendiente hasta
          que la apruebes o la rechaces.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              Sucursal <span aria-hidden="true">*</span>
            </span>
            <select
              aria-label="Sucursal de la solicitud"
              required
              aria-invalid={validation !== null && branchId === ""}
              aria-describedby={
                validation !== null && branchId === "" ? "request-approval-validation" : undefined
              }
              className={fieldClassName}
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setValidation(null);
              }}
            >
              <option value="">Elegí una sucursal</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              Profesional <span aria-hidden="true">*</span>
            </span>
            <select
              aria-label="Profesional asignado"
              required
              aria-invalid={validation !== null && professionalMembershipId === ""}
              aria-describedby={
                validation !== null && professionalMembershipId === ""
                  ? "request-approval-validation"
                  : undefined
              }
              className={fieldClassName}
              value={professionalMembershipId}
              onChange={(event) => {
                setProfessionalMembershipId(event.target.value);
                setValidation(null);
              }}
            >
              <option value="">Elegí un profesional</option>
              {professionals.map((professional) => (
                <option key={professional.membershipId} value={professional.membershipId}>
                  {professionalDisplayLabel(professional.membershipId, professional.displayName)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Nuevo inicio (opcional)</span>
            <input
              type="datetime-local"
              aria-label="Nuevo horario de inicio"
              className={fieldClassName}
              value={startAt}
              aria-invalid={
                overrideValidation && (startAt === "" || isInvalidLocalDateTime(startAt))
              }
              aria-describedby={overrideValidation ? "request-approval-validation" : undefined}
              onChange={(event) => {
                setStartAt(event.target.value);
                setValidation(null);
              }}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Nuevo fin (opcional)</span>
            <input
              type="datetime-local"
              aria-label="Nuevo horario de fin"
              className={fieldClassName}
              value={endAt}
              aria-invalid={overrideValidation && (endAt === "" || isInvalidLocalDateTime(endAt))}
              aria-describedby={overrideValidation ? "request-approval-validation" : undefined}
              onChange={(event) => {
                setEndAt(event.target.value);
                setValidation(null);
              }}
            />
          </label>
        </div>
        <div className="space-y-2">
          {validation !== null && (
            <p id="request-approval-validation" role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          )}
          {error !== null && decision === null && (
            <p role="alert" className="text-sm text-destructive">
              {userFacingBookingRequestError(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={isPending} onClick={handleApprove}>
              {isPending ? "Procesando…" : "Aprobar solicitud"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setDecision("reject")}
            >
              Rechazar solicitud
            </Button>
          </div>
        </div>
      </CardContent>
      <ConfirmActionDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setDecision(null);
        }}
        title={decision === "approve" ? "Aprobar esta solicitud" : "Rechazar esta solicitud"}
        description={
          decision === "approve"
            ? "Se creará un turno con la sucursal, el profesional y el horario seleccionados."
            : "La solicitud dejará de aparecer como pendiente en la agenda."
        }
        confirmLabel={decision === "approve" ? "Aprobar solicitud" : "Rechazar solicitud"}
        confirmVariant={decision === "reject" ? "destructive" : "default"}
        pending={isPending}
        pendingLabel="Procesando…"
        errorMessage={error === null ? undefined : userFacingBookingRequestError(error)}
        onConfirm={async () => {
          if (decision === "reject") {
            await onReject();
            return;
          }
          if (decision !== "approve") return;
          if (startAt !== "" && endAt !== "") {
            const startIso = tryLocalInputToIso(startAt);
            const endIso = tryLocalInputToIso(endAt);
            if (startIso === null || endIso === null)
              throw new Error("Revisá los horarios antes de confirmar.");
            await onApprove({
              branchId,
              professionalMembershipId,
              startAt: startIso,
              endAt: endIso,
            });
            return;
          }
          await onApprove({ branchId, professionalMembershipId });
        }}
      />
    </Card>
  );
}

/**
 * Staff agenda: day/week/month/list views over the tenant's branch-scoped
 * appointments, with filters, time-range creation, drag/resize rescheduling and
 * explicit lifecycle commands.
 *
 * Every request goes through the authenticated `/api/scheduling` proxy; tenant
 * identity is resolved server-side. Permission checks are UX-only — the backend
 * enforces the actual gates and the 403 response drives the permission-denied
 * state. Loading, empty, error, success and denied states are explicit.
 */
export function Agenda(): JSX.Element {
  const queryClient = useQueryClient();
  const [view, setView] = useState<AgendaView>("day");
  const [anchor, setAnchor] = useState<string>(() => dateKeyOf(new Date().toISOString()));
  const [branchFilter, setBranchFilter] = useState("");
  const [professionalFilter, setProfessionalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | AppointmentStatus>("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState<{
    readonly appointmentId: string;
    readonly current: Appointment;
  } | null>(null);

  const filters = useMemo(
    () => ({
      ...(branchFilter !== "" && { branchId: branchFilter }),
      ...(professionalFilter !== "" && { professionalMembershipId: professionalFilter }),
      ...(statusFilter !== "" && { status: statusFilter }),
      ...(serviceFilter !== "" && { serviceId: serviceFilter }),
    }),
    [branchFilter, professionalFilter, statusFilter, serviceFilter]
  );

  const optionsQuery = useQuery({
    queryKey: ["scheduling", "options"],
    queryFn: listAppointmentOptions,
  });
  const appointmentsQuery = useQuery({
    queryKey: ["scheduling", "appointments", filters],
    queryFn: () => listAppointments(filters),
  });
  const requestsQuery = useQuery({
    queryKey: ["scheduling", "booking-requests"],
    queryFn: listBookingRequests,
  });
  // The `scheduling` namespace read that feeds the availability overlay. The
  // settings proxy is a separate allowlisted surface, so this does not go
  // through the `/api/scheduling` proxy used for appointments.
  const settingsQuery = useQuery({
    queryKey: ["scheduling", "settings"],
    queryFn: getSchedulingSettings,
  });
  // The active SERVICE items the selector and the agenda filter offer. This
  // reuses the catalog client instead of duplicating one, and it is a
  // CONVENIENCE read: the API remains the authority, so a failure degrades to an
  // empty selector with a clear message rather than a blocked page or an
  // invented permission rule.
  const serviceOptionsQuery = useQuery({
    queryKey: ["catalog", "service-options"],
    queryFn: () => listCatalogItems({ kind: "SERVICE", isActive: true }),
  });

  function invalidateAppointments(): void {
    void queryClient.invalidateQueries({ queryKey: ["scheduling", "appointments"] });
  }

  function invalidateRequests(): void {
    void queryClient.invalidateQueries({ queryKey: ["scheduling", "booking-requests"] });
  }

  /**
   * Self-correction for an overloaded 409 on a booking-request decision.
   *
   * A decision 409 carries no reliable cause — the slot may have become
   * unavailable OR the request may have been decided by someone else since the
   * panel opened. The envelope's `code` is the contract and the message text is
   * not, so instead of guessing from the message we refresh BOTH layers and let
   * the data decide. When the request is no longer PENDING after the refresh it
   * was decided concurrently, so the now-stale panel is closed; when it is still
   * PENDING the panel stays open for a different slot or a rejection.
   */
  async function refreshAfterDecisionConflict(requestId: string): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheduling", "booking-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["scheduling", "appointments"] }),
    ]);
    const refreshed = queryClient.getQueryData<BookingRequest[]>([
      "scheduling",
      "booking-requests",
    ]);
    const stillPending =
      refreshed?.some((request) => request.id === requestId && request.status === "PENDING") ??
      false;
    if (!stillPending) {
      setEditor((current) =>
        current?.kind === "request" && current.request.id === requestId ? null : current
      );
      setNotice("Otra persona ya resolvió esta solicitud. Actualizamos la agenda.");
    }
  }

  /** Clears any stale-version notice when the staff member opens or closes an editor. */
  function setEditorClearingConflict(next: EditorState): void {
    setStaleConflict(null);
    setEditor(next);
  }

  const createMutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: () => {
      setEditor(null);
      setNotice("Turno creado.");
      invalidateAppointments();
    },
    // Any failed write leaves the calendar showing server truth.
    onError: () => {
      invalidateAppointments();
    },
  });
  const rescheduleMutation = useMutation({
    mutationFn: (input: {
      id: string;
      startAt: string;
      endAt: string;
      version: number;
      serviceId?: string | null;
    }) =>
      rescheduleAppointment(input.id, {
        startAt: input.startAt,
        endAt: input.endAt,
        version: input.version,
        // Omitted when absent (a calendar drag), so the stored link is left
        // untouched; `null` is an explicit clear from the edit surface.
        ...(input.serviceId !== undefined && { serviceId: input.serviceId }),
      }),
    onSuccess: () => {
      setStaleConflict(null);
      setEditor(null);
      setNotice("Turno reprogramado.");
      invalidateAppointments();
    },
    onError: (error, input) => {
      // Refresh the calendar either way, then classify the 409: a changed
      // version means another writer updated the appointment; unchanged means
      // the reschedule overlapped or fell outside availability.
      invalidateAppointments();
      if (isAgendaConflict(error)) {
        void refreshOnVersionConflict(input.id, input.version);
      }
    },
  });
  const transitionMutation = useMutation({
    mutationFn: (input: { id: string; command: TransitionCommand }) =>
      transitionAppointment(input.id, input.command),
    onSuccess: () => {
      setStaleConflict(null);
      setEditor(null);
      setNotice("Estado del turno actualizado.");
      invalidateAppointments();
    },
    onError: () => {
      invalidateAppointments();
    },
  });
  const approveRequestMutation = useMutation({
    mutationFn: (input: { id: string; body: ApproveBookingRequestInput }) =>
      approveBookingRequest(input.id, input.body),
    onSuccess: () => {
      // Approval creates an appointment AND decides the request, so refresh
      // both layers: the request leaves the pending layer and the new
      // appointment appears. Closing the panel is what marks the request decided.
      setStaleConflict(null);
      setEditor(null);
      setNotice("Solicitud aprobada; se creó el turno.");
      invalidateRequests();
      invalidateAppointments();
    },
    onError: (error, input) => {
      // A failed decision is never shown as a decided one. A 409 is
      // self-corrected by refreshing both layers and reporting the fresh state;
      // any other failure just re-reads the pending layer.
      if (isAgendaConflict(error)) {
        void refreshAfterDecisionConflict(input.id);
        return;
      }
      invalidateRequests();
    },
  });
  const rejectRequestMutation = useMutation({
    mutationFn: (id: string) => rejectBookingRequest(id),
    onSuccess: () => {
      setStaleConflict(null);
      setEditor(null);
      setNotice("Solicitud rechazada.");
      invalidateRequests();
    },
    onError: (error, id) => {
      if (isAgendaConflict(error)) {
        void refreshAfterDecisionConflict(id);
        return;
      }
      invalidateRequests();
    },
  });

  /**
   * Confirms whether a 409 was a stale optimistic version by re-reading the
   * appointment. When the stored version advanced, the staff member is told the
   * appointment changed and the Manage form is refreshed to the current values;
   * otherwise the generic overlap/availability message stands.
   */
  async function refreshOnVersionConflict(id: string, submittedVersion: number): Promise<void> {
    try {
      const current = await getAppointment(id);
      if (current.version === submittedVersion) {
        return;
      }
      setStaleConflict({ appointmentId: id, current });
      setEditor({ kind: "manage", appointment: current });
    } catch {
      // The refresh itself failed; keep the generic conflict message.
    }
  }

  const branches = optionsQuery.data?.branches ?? [];
  const professionals = optionsQuery.data?.professionals ?? [];
  const branchLabel = (branchId: string): string =>
    branches.find((branch) => branch.id === branchId)?.name ?? "Sucursal";

  const professionalLabel = (membershipId: string): string =>
    professionalDisplayLabel(
      membershipId,
      professionals.find((item) => item.membershipId === membershipId)?.displayName
    );

  // Projected to id + name so no catalog price, tax, rate or currency can reach
  // the selector or the filter. A failed read yields an empty list, which the
  // UI reports honestly instead of blocking the appointment surface.
  const serviceOptions = useMemo<readonly ServiceOption[]>(
    () => (serviceOptionsQuery.data ?? []).map((item) => ({ id: item.id, name: item.name })),
    [serviceOptionsQuery.data]
  );
  const serviceOptionsUnavailable = serviceOptionsQuery.isError;

  // The overlay is only honest for a concrete (professional, branch) pair:
  // `businessHours` is calendar-global while the windows carry a branchId, so
  // with either filter cleared there is nothing truthful to shade.
  const overlayPairSelected = branchFilter !== "" && professionalFilter !== "";
  const showsHourOverlay = view === "day" || view === "week";
  const showAvailabilityHint = showsHourOverlay && !overlayPairSelected;
  // A failed (or malformed) settings read leaves the pair's hours unknown. That
  // must not read as "unrestricted": the query error becomes a non-blocking
  // warning so an unshaded day is never mistaken for a pair with no windows.
  const showAvailabilityUnavailable =
    showsHourOverlay && overlayPairSelected && settingsQuery.isError;
  const availabilityOverlay = useMemo<AvailabilityOverlay | undefined>(() => {
    if (!overlayPairSelected || settingsQuery.data === undefined) {
      return undefined;
    }
    return buildAvailabilityOverlay(settingsQuery.data, professionalFilter, branchFilter);
  }, [overlayPairSelected, settingsQuery.data, professionalFilter, branchFilter]);

  const denied =
    appointmentsQuery.error !== null && isAgendaPermissionDenied(appointmentsQuery.error);
  const mutationPending =
    createMutation.isPending || rescheduleMutation.isPending || transitionMutation.isPending;
  const mutationError =
    createMutation.error ?? rescheduleMutation.error ?? transitionMutation.error;

  // The agenda shows only actionable demand; a decided request is history the
  // decide path no longer needs.
  const pendingRequests = (requestsQuery.data ?? []).filter(
    (request) => request.status === "PENDING"
  );
  const identities = usePatientIdentities([
    ...(appointmentsQuery.data ?? []).map((appointment) => appointment.patientId),
    ...pendingRequests.map((request) => request.patientId),
  ]);
  const patientNames = useMemo(
    () =>
      new Map(
        (identities.isError ? [] : (identities.data ?? [])).map((patient) => [
          patient.id,
          patient.name,
        ])
      ),
    [identities.data, identities.isError]
  );
  const patientLabel = useCallback(
    (id: string) => patientNames.get(id) ?? "Paciente (nombre no disponible)",
    [patientNames]
  );
  const requestsDenied =
    requestsQuery.error !== null && isAgendaPermissionDenied(requestsQuery.error);
  const requestMutationPending =
    approveRequestMutation.isPending || rejectRequestMutation.isPending;
  const requestMutationError = approveRequestMutation.error ?? rejectRequestMutation.error;

  function step(direction: 1 | -1): void {
    if (view === "month") {
      setAnchor((current) => addMonthsToKey(current, direction));
      return;
    }
    const days = view === "week" ? 7 : 1;
    setAnchor((current) => addDaysToKey(current, direction * days));
  }

  function handleRescheduleRange(appointment: Appointment, startIso: string, endIso: string): void {
    rescheduleMutation.mutate({
      id: appointment.id,
      startAt: startIso,
      endAt: endIso,
      version: appointment.version,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Organizá turnos por sucursal y profesional.
          </p>
        </div>
        <Button type="button" onClick={() => setEditorClearingConflict({ kind: "create" })}>
          Nuevo turno
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Vista de agenda">
          {VIEWS.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              variant={view === entry.id ? "default" : "outline"}
              size="sm"
              aria-pressed={view === entry.id}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => step(-1)}>
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(dateKeyOf(new Date().toISOString()))}
          >
            Hoy
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => step(1)}>
            Siguiente
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Sucursal</span>
          <select
            aria-label="Filtrar por sucursal"
            className={`${controlClassName} w-full`}
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            <option value="">Todas las sucursales</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Profesional</span>
          <select
            aria-label="Filtrar por profesional"
            className={`${controlClassName} w-full`}
            value={professionalFilter}
            onChange={(event) => setProfessionalFilter(event.target.value)}
          >
            <option value="">Todos los profesionales</option>
            {professionals.map((professional) => (
              <option key={professional.membershipId} value={professional.membershipId}>
                {professionalDisplayLabel(professional.membershipId, professional.displayName)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Estado</span>
          <select
            aria-label="Filtrar por estado"
            className={`${controlClassName} w-full`}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "" | AppointmentStatus)}
          >
            <option value="">Todos los estados</option>
            {APPOINTMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {APPOINTMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Servicio</span>
          <select
            aria-label="Filtrar por servicio"
            className={`${controlClassName} w-full`}
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value)}
          >
            <option value="">Todos los servicios</option>
            {serviceOptions.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/*
        The service list is a convenience, not a gate: when its read fails the
        selectors stay empty and this message says so, while every other control
        — including saving an appointment without a service — keeps working. The
        client never invents a permission rule from a failed read.
      */}
      {serviceOptionsUnavailable && (
        <p
          role="status"
          data-testid="service-options-unavailable"
          className="text-sm text-muted-foreground"
        >
          {SERVICE_OPTIONS_UNAVAILABLE}
        </p>
      )}

      {showAvailabilityHint && (
        <p data-testid="availability-hint" className="text-sm text-muted-foreground">
          {AVAILABILITY_HINT}
        </p>
      )}

      {showAvailabilityUnavailable && (
        <p
          role="status"
          data-testid="availability-warning"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {AVAILABILITY_UNAVAILABLE}
        </p>
      )}

      {notice !== null && (
        <p role="status" className="rounded-md border bg-secondary px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      {/**
       * Pending-request state layer. The requests themselves render as distinct
       * events on the calendar and as rows in the accessible list view; this
       * region only surfaces the loading/empty/error/denied states so "no pending
       * requests" reads as the normal state, never as an error.
       */}
      <section aria-label="Solicitudes de turno pendientes" className="space-y-2">
        {requestsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando solicitudes pendientes…</p>
        ) : requestsQuery.error ? (
          <div
            role="alert"
            data-testid="pending-requests-alert"
            data-state={requestsDenied ? "denied" : "error"}
            className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {userFacingBookingRequestError(requestsQuery.error)}
          </div>
        ) : pendingRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay solicitudes de turno pendientes.</p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {pendingRequests.length === 1
              ? "Hay 1 solicitud pendiente en el calendario y la lista."
              : `Hay ${pendingRequests.length} solicitudes pendientes en el calendario y la lista.`}
          </p>
        )}
      </section>

      {identities.error && (
        <div role="status" className="space-y-2 rounded-lg border bg-muted p-3 text-sm">
          <p>{patientLookupError(identities.error)} Podés seguir gestionando los turnos.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void identities.refetch();
            }}
          >
            Reintentar nombres
          </Button>
        </div>
      )}
      {editor?.kind === "create" && (
        <CreateAppointmentForm
          branches={branches}
          professionals={professionals}
          services={serviceOptions}
          isPending={createMutation.isPending}
          error={createMutation.error}
          {...(editor.startAt !== undefined && { initialStartAt: editor.startAt })}
          {...(editor.endAt !== undefined && { initialEndAt: editor.endAt })}
          onClose={() => setEditorClearingConflict(null)}
          onSubmit={(input) => createMutation.mutate(input)}
        />
      )}
      {staleConflict !== null && (
        <div
          role="alert"
          data-testid="stale-version-alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Otra persona modificó este turno. Revisá los datos actualizados antes de volver a
          intentarlo.
        </div>
      )}
      {editor?.kind === "manage" && (
        <ManageAppointmentForm
          key={`${editor.appointment.id}:${editor.appointment.version}`}
          appointment={editor.appointment}
          patientName={patientLabel(editor.appointment.patientId)}
          services={serviceOptions}
          isPending={mutationPending}
          error={staleConflict !== null ? null : mutationError}
          onClose={() => setEditorClearingConflict(null)}
          onReschedule={(startIso, endIso, serviceId) =>
            rescheduleMutation.mutate({
              id: editor.appointment.id,
              startAt: startIso,
              endAt: endIso,
              version: editor.appointment.version,
              serviceId,
            })
          }
          onTransition={async (command) => {
            await transitionMutation.mutateAsync({ id: editor.appointment.id, command });
          }}
        />
      )}

      {editor?.kind === "request" && (
        <BookingRequestDecisionForm
          key={editor.request.id}
          request={editor.request}
          patientName={patientLabel(editor.request.patientId)}
          branches={branches}
          professionals={professionals}
          isPending={requestMutationPending}
          error={requestMutationError}
          onApprove={async (input) => {
            await approveRequestMutation.mutateAsync({ id: editor.request.id, body: input });
          }}
          onReject={async () => {
            await rejectRequestMutation.mutateAsync(editor.request.id);
          }}
          onClose={() => setEditorClearingConflict(null)}
        />
      )}

      {appointmentsQuery.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Cargando agenda…</p>
          </CardContent>
        </Card>
      ) : denied ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {userFacingAgendaError(appointmentsQuery.error)}
        </div>
      ) : appointmentsQuery.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {userFacingAgendaError(appointmentsQuery.error)}
        </div>
      ) : appointmentsQuery.data?.length === 0 && pendingRequests.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold">Todavía no hay turnos</h2>
            <p className="text-sm text-muted-foreground">
              No encontramos turnos con los filtros seleccionados.
            </p>
          </CardContent>
        </Card>
      ) : (
        <AgendaViews
          view={view}
          anchor={anchor}
          appointments={appointmentsQuery.data ?? []}
          requests={pendingRequests}
          branchLabel={branchLabel}
          professionalLabel={professionalLabel}
          patientLabel={patientLabel}
          {...(showsHourOverlay &&
            availabilityOverlay !== undefined && { overlay: availabilityOverlay })}
          onOpen={(appointment) => setEditorClearingConflict({ kind: "manage", appointment })}
          onOpenRequest={(request) => setEditorClearingConflict({ kind: "request", request })}
          onCreateRange={(startIso, endIso) =>
            setEditorClearingConflict({ kind: "create", startAt: startIso, endAt: endIso })
          }
          onRescheduleRange={handleRescheduleRange}
        />
      )}
    </div>
  );
}
