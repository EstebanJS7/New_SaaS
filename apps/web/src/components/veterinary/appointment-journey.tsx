"use client";

import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@newsaas/ui/components/ui/card";
import { getAppointment, listAppointmentOptions } from "@/app/(app)/app/agenda/agenda-api";
import { getPatient } from "@/app/(app)/app/patients/patients-api";
import { formatEsPyInstant } from "@/lib/es-py-format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statusLabels = {
  SCHEDULED: "Programado",
  CONFIRMED: "Confirmado",
  ARRIVED: "Llegó",
  IN_PROGRESS: "En atención",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  NO_SHOW: "No asistió",
};

/** Navigation hints only. The existing private reads remain the authority. */
export function AppointmentJourney({
  appointmentId,
  patientId,
  onAddService,
  inPOS = patientId === undefined,
}: {
  appointmentId: string;
  patientId?: string;
  onAddService?: (serviceId: string) => void;
  inPOS?: boolean;
}) {
  const valid = UUID.test(appointmentId) && (patientId === undefined || UUID.test(patientId));
  const appointment = useQuery({
    queryKey: ["scheduling", "appointment-context", appointmentId],
    queryFn: () => getAppointment(appointmentId),
    enabled: valid,
    retry: false,
    staleTime: 0,
  });
  const row = appointment.data;
  const matches =
    row?.id.toLowerCase() === appointmentId.toLowerCase() &&
    UUID.test(row.patientId) &&
    (patientId === undefined || row.patientId.toLowerCase() === patientId.toLowerCase());
  const options = useQuery({
    queryKey: ["scheduling", "options"],
    queryFn: listAppointmentOptions,
    enabled: matches && !appointment.isError,
    retry: false,
  });
  const patient = useQuery({
    queryKey: ["patients", row?.patientId],
    queryFn: () => getPatient(row!.patientId),
    enabled: matches && !appointment.isError,
    retry: false,
  });

  if (!valid || appointment.isError || (row !== undefined && !matches))
    return (
      <section
        aria-label="Contexto de la cita"
        className="space-y-3 rounded-lg border border-border bg-secondary p-4 text-sm"
      >
        <p role="alert">
          No pudimos verificar la cita de origen para este paciente. Podés continuar sin vincularla
          desde la agenda o usar esta pantalla de forma independiente.
        </p>
        {valid && (
          <Button
            type="button"
            variant="outline"
            disabled={appointment.isFetching}
            onClick={() => void appointment.refetch()}
          >
            Volver a leer la cita
          </Button>
        )}
        <Link
          href="/app/agenda"
          className="inline-flex min-h-10 items-center text-primary underline"
        >
          Volver a agenda
        </Link>
      </section>
    );
  if (!row)
    return (
      <p role="status" className="rounded-lg border border-border p-4 text-sm">
        Cargando contexto de la cita…
      </p>
    );
  const professional = options.data?.professionals
    .find((item) => item.membershipId === row.professionalMembershipId)
    ?.displayName?.trim();
  return (
    <Card className="space-y-3 p-5" role="region" aria-label="Contexto de la cita">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Cita de origen</h2>
        <span className="rounded-md bg-secondary px-2 py-1 text-xs">
          {statusLabels[row.status]}
        </span>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Paciente</dt>
          <dd className="break-words font-medium">
            {patient.isError
              ? "Nombre no disponible"
              : (patient.data?.name ?? "Cargando paciente…")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Fecha y hora</dt>
          <dd className="break-words">{formatEsPyInstant(row.startAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Profesional asignado a la cita</dt>
          <dd className="break-words">
            {professional ?? (options.isPending ? "Cargando profesional…" : "Nombre no disponible")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Servicio agendado</dt>
          <dd className="break-words">{row.service?.name ?? "Sin servicio asignado"}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Este contexto facilita la navegación. La consulta y la venta se registran por separado; no
        se vinculan automáticamente a esta cita.
      </p>
      {inPOS && (
        <p className="text-xs text-muted-foreground">
          Elegí los artículos y el cliente de la venta. El servicio agendado no agrega un cargo ni
          define su precio.
        </p>
      )}
      {onAddService && row.service && (
        <Button
          type="button"
          variant="outline"
          disabled={appointment.isFetching}
          onClick={() => onAddService(row.service!.id)}
        >
          Agregar servicio agendado al carrito
        </Button>
      )}
      <div className="flex flex-wrap gap-4 text-sm font-medium text-primary">
        <Link
          className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/app/agenda"
        >
          Volver a agenda
        </Link>
        {inPOS && (
          <Link
            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/app/patients/${row.patientId}?appointment=${row.id}#patient-clinical`}
          >
            Volver a la ficha del paciente
          </Link>
        )}
      </div>
    </Card>
  );
}
