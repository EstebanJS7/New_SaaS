"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@newsaas/ui/components/ui/card";
import { Icon, type IconName } from "@newsaas/ui/components/ui/icon";
import { listCustomers } from "../../customers/customers-api";
import { getPatient, listGuardians } from "../patients-api";
import { listEncounters } from "./clinical-api";
import { formatRecordedDate, listVaccinationViews } from "./clinical-records";
import { dateKeyOf } from "../../agenda/agenda-time";
import { formatEsPyInstant } from "@/lib/es-py-format";

function OverviewCard({
  title,
  value,
  detail,
  href,
  icon,
  action,
}: {
  title: string;
  value: string;
  detail: string;
  href: string;
  icon: IconName;
  action?: string;
}) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name={icon} />
        <h2 className="font-medium">{title}</h2>
      </div>
      <p className="break-words text-lg font-semibold tracking-tight">{value}</p>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p>
      <a
        href={href}
        className="mt-auto inline-flex min-h-10 items-center gap-1 self-start rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {action ?? `Ver ${title.toLowerCase()}`}
        <Icon name="chevron" />
      </a>
    </Card>
  );
}

/** Existing staff reads only; cache keys and data shapes match the editors. */
export function PatientOverview({ patientId }: { patientId: string }) {
  const patient = useQuery({
    queryKey: ["patients", patientId],
    queryFn: () => getPatient(patientId),
  });
  const guardians = useQuery({
    queryKey: ["patients", patientId, "guardians"],
    queryFn: () => listGuardians(patientId),
  });
  const customers = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const encounters = useQuery({
    queryKey: ["clinical", patientId, "encounters"],
    queryFn: () => listEncounters(patientId),
    retry: false,
  });
  const vaccines = useQuery({
    queryKey: ["clinical", patientId, "vaccinations"],
    queryFn: () => listVaccinationViews(patientId),
    retry: false,
  });

  const primary = guardians.data?.find((item) => item.isPrimary && item.isActive);
  const guardianName = customers.data?.find((item) => item.id === primary?.customerId)?.displayName;
  const latest = [...(encounters.data ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )[0];
  const dated = [...(vaccines.data ?? [])]
    .filter((item) => item.nextDueAt !== null)
    .sort((a, b) => (a.nextDueAt ?? "").localeCompare(b.nextDueAt ?? ""));
  const today = dateKeyOf(new Date().toISOString());
  const previousDates = dated.filter(
    (item) => item.nextDueAt !== null && item.nextDueAt.slice(0, 10) < today
  );
  const next = dated.find(
    (item) => item.nextDueAt !== null && item.nextDueAt.slice(0, 10) >= today
  );
  const guardianUnavailable = guardians.isError || customers.isError;

  return (
    <section
      id="patient-overview"
      aria-label="Resumen del paciente"
      className="scroll-mt-24 space-y-4"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <OverviewCard
          icon="users"
          title="Responsable principal"
          href="#patient-guardians"
          value={
            guardianUnavailable
              ? "No disponible"
              : guardians.isPending || customers.isPending
                ? "Cargando…"
                : (guardianName ?? (primary ? "Nombre no disponible" : "Sin responsable principal"))
          }
          detail={
            guardianUnavailable
              ? "Revisá los permisos o volvé a cargar la ficha."
              : "La persona de referencia para este paciente."
          }
        />
        <OverviewCard
          icon="activity"
          title="Última consulta"
          action="Ver ficha clínica"
          href="#patient-clinical"
          value={
            encounters.isError
              ? "No disponible"
              : encounters.isPending
                ? "Cargando…"
                : latest
                  ? formatEsPyInstant(latest.createdAt)
                  : "Sin consultas registradas"
          }
          detail={
            encounters.isError
              ? "No pudimos consultar el historial clínico."
              : latest
                ? `${latest.status === "DRAFT" ? "Borrador" : "Cerrada"} · ${latest.reasonForVisit ?? "Consulta sin título"}`
                : "Creá o revisá las consultas desde la ficha clínica."
          }
        />
        <OverviewCard
          icon="calendar"
          title="Próxima vacuna"
          href="#patient-prevention"
          value={
            vaccines.isError
              ? "No disponible"
              : vaccines.isPending
                ? "Cargando…"
                : next?.nextDueAt
                  ? formatRecordedDate(next.nextDueAt)
                  : "Sin próxima fecha registrada"
          }
          detail={
            vaccines.isError
              ? "No pudimos consultar las fechas de vacunación."
              : next
                ? next.name
                : "Solo se muestran fechas ingresadas por el equipo."
          }
        />
      </div>
      {patient.data?.isActive === false && (
        <p className="rounded-lg border border-border bg-secondary p-4 text-sm">
          Este paciente está inactivo. Su historial se conserva.
        </p>
      )}
      {guardians.isSuccess && primary === undefined && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm">
          No hay un responsable principal activo. Revisá los vínculos en{" "}
          <a className="font-medium underline" href="#patient-guardians">
            Responsables
          </a>
          .
        </p>
      )}
      {vaccines.isSuccess && previousDates.length > 0 && (
        <p className="flex items-start gap-3 rounded-lg border border-border bg-secondary p-4 text-sm">
          <Icon name="alert" className="mt-0.5" />
          <span>
            Hay{" "}
            {previousDates.length === 1
              ? "una fecha de vacunación registrada anterior a hoy"
              : `${previousDates.length} fechas de vacunación registradas anteriores a hoy`}
            .{" "}
            <a className="font-medium underline" href="#patient-prevention">
              Revisar registros
            </a>
            . El equipo debe confirmar su seguimiento.
          </span>
        </p>
      )}
    </section>
  );
}
