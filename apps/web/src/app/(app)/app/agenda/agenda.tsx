"use client";

import type { FormEvent, JSX } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { Card, CardContent } from "@newsaas/ui/components/ui/card";
import {
  APPOINTMENT_STATUSES,
  allowedTransitions,
  approveBookingRequest,
  createAppointment,
  getAppointment,
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
  type TransitionCommand,
} from "./agenda-api";
import { AgendaViews, type AgendaView } from "./agenda-views";
import {
  addDaysToKey,
  addMonthsToKey,
  dateKeyOf,
  formatDayHeading,
  formatTimeRange,
  isoToLocalInput,
  tryLocalInputToIso,
} from "./agenda-time";

const VIEWS: readonly { readonly id: AgendaView; readonly label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "list", label: "List" },
];

const controlClassName =
  "h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const fieldClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type EditorState =
  | { readonly kind: "create"; readonly startAt?: string; readonly endAt?: string }
  | { readonly kind: "manage"; readonly appointment: Appointment }
  | { readonly kind: "request"; readonly request: BookingRequest }
  | null;

/** Create form: anchors plus a tenant wall-clock start/end range. */
function CreateAppointmentForm({
  branches,
  professionals,
  isPending,
  error,
  initialStartAt,
  initialEndAt,
  onSubmit,
  onClose,
}: {
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly professionals: readonly { readonly membershipId: string }[];
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly initialStartAt?: string;
  readonly initialEndAt?: string;
  readonly onSubmit: (input: {
    branchId: string;
    patientId: string;
    professionalMembershipId: string;
    startAt: string;
    endAt: string;
  }) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [professionalMembershipId, setProfessionalMembershipId] = useState(
    professionals[0]?.membershipId ?? ""
  );
  const [patientId, setPatientId] = useState("");
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
    if (branchId === "" || professionalMembershipId === "" || patientId.trim() === "") {
      setValidation("Select a branch and professional and enter a patient id.");
      return;
    }
    if (startIso === null || endIso === null || Date.parse(endIso) <= Date.parse(startIso)) {
      setValidation("Enter a valid range where the end is after the start.");
      return;
    }
    setValidation(null);
    onSubmit({
      branchId,
      patientId: patientId.trim(),
      professionalMembershipId,
      startAt: startIso,
      endAt: endIso,
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">New appointment</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Branch</span>
            <select
              aria-label="Branch"
              className={fieldClassName}
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Professional</span>
            <select
              aria-label="Professional"
              className={fieldClassName}
              value={professionalMembershipId}
              onChange={(event) => setProfessionalMembershipId(event.target.value)}
            >
              {professionals.map((professional) => (
                <option key={professional.membershipId} value={professional.membershipId}>
                  {professional.membershipId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Patient id</span>
            <input
              aria-label="Patient id"
              className={fieldClassName}
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              placeholder="Patient UUID"
            />
          </label>
          <div aria-hidden className="hidden sm:block" />
          <label className="space-y-1 text-sm">
            <span className="font-medium">Start</span>
            <input
              type="datetime-local"
              aria-label="Start"
              className={fieldClassName}
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">End</span>
            <input
              type="datetime-local"
              aria-label="End"
              className={fieldClassName}
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
            />
          </label>
          <div className="sm:col-span-2">
            {validation !== null && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {validation}
              </p>
            )}
            {error !== null && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {userFacingAgendaError(error)}
              </p>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create appointment"}
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
  isPending,
  error,
  onReschedule,
  onTransition,
  onClose,
}: {
  readonly appointment: Appointment;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onReschedule: (startIso: string, endIso: string) => void;
  readonly onTransition: (command: TransitionCommand) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [startAt, setStartAt] = useState(() => isoToLocalInput(appointment.startAt));
  const [endAt, setEndAt] = useState(() => isoToLocalInput(appointment.endAt));
  const [validation, setValidation] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const startIso = tryLocalInputToIso(startAt);
    const endIso = tryLocalInputToIso(endAt);
    if (startIso === null || endIso === null || Date.parse(endIso) <= Date.parse(startIso)) {
      setValidation("Enter a valid range where the end is after the start.");
      return;
    }
    setValidation(null);
    onReschedule(startIso, endIso);
  }

  const transitions = allowedTransitions(appointment.status);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Manage appointment</h2>
            <p className="text-xs text-muted-foreground">
              {formatDayHeading(dateKeyOf(appointment.startAt))} ·{" "}
              {formatTimeRange(appointment.startAt, appointment.endAt)}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Start</span>
            <input
              type="datetime-local"
              aria-label="Start"
              className={fieldClassName}
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">End</span>
            <input
              type="datetime-local"
              aria-label="End"
              className={fieldClassName}
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
            />
          </label>
          <div className="sm:col-span-2">
            {validation !== null && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {validation}
              </p>
            )}
            {error !== null && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {userFacingAgendaError(error)}
              </p>
            )}
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save reschedule"}
            </Button>
          </div>
        </form>
        {transitions.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Lifecycle</p>
            <div className="flex flex-wrap gap-2">
              {transitions.map((command) => (
                <Button
                  key={command}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onTransition(command)}
                >
                  {command.replace("-", " ")}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
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
  branches,
  professionals,
  isPending,
  error,
  onApprove,
  onReject,
  onClose,
}: {
  readonly request: BookingRequest;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly professionals: readonly { readonly membershipId: string }[];
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onApprove: (input: ApproveBookingRequestInput) => void;
  readonly onReject: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [professionalMembershipId, setProfessionalMembershipId] = useState(
    professionals[0]?.membershipId ?? ""
  );
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  function handleApprove(): void {
    if (branchId === "" || professionalMembershipId === "") {
      setValidation("Select a branch and professional to approve this request.");
      return;
    }
    const hasStart = startAt !== "";
    const hasEnd = endAt !== "";
    if (hasStart !== hasEnd) {
      setValidation("Enter both override times or leave them empty.");
      return;
    }
    if (hasStart && hasEnd) {
      const startIso = tryLocalInputToIso(startAt);
      const endIso = tryLocalInputToIso(endAt);
      if (startIso === null || endIso === null || Date.parse(endIso) <= Date.parse(startIso)) {
        setValidation("Enter a valid override where the end is after the start.");
        return;
      }
      setValidation(null);
      onApprove({ branchId, professionalMembershipId, startAt: startIso, endAt: endIso });
      return;
    }
    setValidation(null);
    onApprove({ branchId, professionalMembershipId });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Pending booking request</h2>
            <p className="text-xs text-muted-foreground">
              {formatDayHeading(dateKeyOf(request.startAt))} ·{" "}
              {formatTimeRange(request.startAt, request.endAt)} · Patient {request.patientId}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The request does not reserve the slot. Approval creates the appointment; a pending request
          stays visible until it is approved or rejected.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Branch</span>
            <select
              aria-label="Request branch"
              className={fieldClassName}
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Professional</span>
            <select
              aria-label="Request professional"
              className={fieldClassName}
              value={professionalMembershipId}
              onChange={(event) => setProfessionalMembershipId(event.target.value)}
            >
              {professionals.map((professional) => (
                <option key={professional.membershipId} value={professional.membershipId}>
                  {professional.membershipId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Override start (optional)</span>
            <input
              type="datetime-local"
              aria-label="Override start"
              className={fieldClassName}
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Override end (optional)</span>
            <input
              type="datetime-local"
              aria-label="Override end"
              className={fieldClassName}
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
            />
          </label>
        </div>
        <div className="space-y-2">
          {validation !== null && (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {userFacingBookingRequestError(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={isPending} onClick={handleApprove}>
              {isPending ? "Working..." : "Approve request"}
            </Button>
            <Button type="button" variant="outline" disabled={isPending} onClick={onReject}>
              Reject request
            </Button>
          </div>
        </div>
      </CardContent>
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
    }),
    [branchFilter, professionalFilter, statusFilter]
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
      setNotice("This booking request was already decided. The pending layer was refreshed.");
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
      setNotice("Appointment created.");
      invalidateAppointments();
    },
    // Any failed write leaves the calendar showing server truth.
    onError: () => {
      invalidateAppointments();
    },
  });
  const rescheduleMutation = useMutation({
    mutationFn: (input: { id: string; startAt: string; endAt: string; version: number }) =>
      rescheduleAppointment(input.id, {
        startAt: input.startAt,
        endAt: input.endAt,
        version: input.version,
      }),
    onSuccess: () => {
      setStaleConflict(null);
      setEditor(null);
      setNotice("Appointment rescheduled.");
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
      setNotice("Appointment updated.");
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
      setNotice("Booking request approved.");
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
      setNotice("Booking request rejected.");
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
    branches.find((branch) => branch.id === branchId)?.name ?? "Branch";

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
            Schedule branch-scoped appointments for veterinarians.
          </p>
        </div>
        <Button type="button" onClick={() => setEditorClearingConflict({ kind: "create" })}>
          New appointment
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Agenda view">
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
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(dateKeyOf(new Date().toISOString()))}
          >
            Today
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => step(1)}>
            Next
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Branch filter</span>
          <select
            aria-label="Branch filter"
            className={`${controlClassName} w-full`}
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Professional filter</span>
          <select
            aria-label="Professional filter"
            className={`${controlClassName} w-full`}
            value={professionalFilter}
            onChange={(event) => setProfessionalFilter(event.target.value)}
          >
            <option value="">All professionals</option>
            {professionals.map((professional) => (
              <option key={professional.membershipId} value={professional.membershipId}>
                {professional.membershipId.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status filter</span>
          <select
            aria-label="Status filter"
            className={`${controlClassName} w-full`}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "" | AppointmentStatus)}
          >
            <option value="">All statuses</option>
            {APPOINTMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>

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
      <section aria-label="Pending booking requests" className="space-y-2">
        {requestsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading pending requests...</p>
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
          <p className="text-sm text-muted-foreground">No pending booking requests.</p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {pendingRequests.length === 1
              ? "1 pending booking request is shown on the calendar and in the list."
              : `${pendingRequests.length} pending booking requests are shown on the calendar and in the list.`}
          </p>
        )}
      </section>

      {editor?.kind === "create" && (
        <CreateAppointmentForm
          branches={branches}
          professionals={professionals}
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
          This appointment was changed by another staff member. The latest details are shown below;
          review them and try again.
        </div>
      )}
      {editor?.kind === "manage" && (
        <ManageAppointmentForm
          key={`${editor.appointment.id}:${editor.appointment.version}`}
          appointment={editor.appointment}
          isPending={mutationPending}
          error={staleConflict !== null ? null : mutationError}
          onClose={() => setEditorClearingConflict(null)}
          onReschedule={(startIso, endIso) =>
            handleRescheduleRange(editor.appointment, startIso, endIso)
          }
          onTransition={(command) =>
            transitionMutation.mutate({ id: editor.appointment.id, command })
          }
        />
      )}

      {editor?.kind === "request" && (
        <BookingRequestDecisionForm
          key={editor.request.id}
          request={editor.request}
          branches={branches}
          professionals={professionals}
          isPending={requestMutationPending}
          error={requestMutationError}
          onApprove={(input) =>
            approveRequestMutation.mutate({ id: editor.request.id, body: input })
          }
          onReject={() => rejectRequestMutation.mutate(editor.request.id)}
          onClose={() => setEditorClearingConflict(null)}
        />
      )}

      {appointmentsQuery.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading agenda...</p>
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
            <h2 className="text-sm font-semibold">No appointments</h2>
            <p className="text-sm text-muted-foreground">
              There are no appointments for the selected filters.
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
