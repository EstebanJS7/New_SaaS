"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { AppointmentJourney } from "@/components/veterinary/appointment-journey";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { Badge } from "@newsaas/ui/components/ui/badge";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { formatEsPyDateOnly } from "@/lib/es-py-format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { listCustomers, type Customer } from "../../customers/customers-api";
import { ClinicalWorkspace } from "./clinical-workspace";
import { TreatmentList } from "./treatment-list";
import { StudyList } from "./study-list";
import { WeightList } from "./weight-list";
import { PatientOverview } from "./patient-overview";
import {
  createGuardian,
  deactivateGuardian,
  deactivatePatient,
  getCatalog,
  getPatient,
  listGuardians,
  setPrimaryGuardian,
  userFacingPatientError,
  type PatientGuardian,
  type SpeciesCatalogEntry,
} from "../patients-api";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function customerName(customers: readonly Customer[] | undefined, customerId: string): string {
  return (
    customers?.find((customer) => customer.id === customerId)?.displayName ?? "Nombre no disponible"
  );
}

function speciesName(catalog: readonly SpeciesCatalogEntry[] | undefined, id: string): string {
  return catalog?.find((species) => species.id === id)?.name ?? "Especie desconocida";
}

function breedName(
  catalog: readonly SpeciesCatalogEntry[] | undefined,
  speciesId: string,
  breedId: string
): string {
  return (
    catalog
      ?.find((species) => species.id === speciesId)
      ?.breeds.find((breed) => breed.id === breedId)?.name ?? "Raza desconocida"
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

function PatientHeader({ patientId }: { readonly patientId: string }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const query = useQuery({
    queryKey: ["patients", patientId],
    queryFn: () => getPatient(patientId),
  });
  const catalog = useQuery({ queryKey: ["patients", "catalog"], queryFn: getCatalog });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivatePatient(patientId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      void queryClient.invalidateQueries({ queryKey: ["patients", patientId] });
    },
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando paciente…</p>;
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {userFacingPatientError(query.error)}
      </div>
    );
  }

  const patient = query.data;
  if (!patient) {
    return <p className="text-sm text-muted-foreground">No encontramos el paciente.</p>;
  }

  const species = speciesName(catalog.data, patient.speciesId);
  const breed = patient.breedId
    ? ` · ${breedName(catalog.data, patient.speciesId, patient.breedId)}`
    : "";

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <Icon name="activity" className="size-7" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Ficha del paciente
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="break-words text-3xl font-semibold tracking-tight">
                  {patient.name}
                </h1>
                <Badge variant={patient.isActive ? "success" : "outline"}>
                  {patient.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {species}
                {breed} ·{" "}
                {patient.sex === "UNKNOWN"
                  ? "Sexo no indicado"
                  : patient.sex === "MALE"
                    ? "Macho"
                    : "Hembra"}
              </p>
              {patient.birthDate && (
                <p className="text-sm text-muted-foreground">
                  Nacimiento: {formatEsPyDateOnly(patient.birthDate.slice(0, 10))}
                </p>
              )}

              {deactivateMutation.error && (
                <p role="alert" className="text-sm text-destructive">
                  {userFacingPatientError(deactivateMutation.error)}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild>
              <a href="#patient-clinical">
                <Icon name="activity" />
                Ir a ficha clínica
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/app/patients/${patient.id}/edit`)}
            >
              Editar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deactivateMutation.isPending || !patient.isActive}
              onClick={() => setConfirmDeactivateOpen(true)}
            >
              {deactivateMutation.isPending ? "Desactivando…" : "Desactivar paciente"}
            </Button>
          </div>
        </div>
        <ConfirmActionDialog
          open={confirmDeactivateOpen}
          onOpenChange={(open) => {
            if (!open && !deactivateMutation.isPending) setConfirmDeactivateOpen(false);
          }}
          title="Desactivar paciente"
          description="El paciente dejará de estar disponible para nuevas operaciones. Sus fichas y registros clínicos se conservarán."
          confirmLabel="Desactivar paciente"
          pendingLabel="Desactivando…"
          pending={deactivateMutation.isPending}
          errorMessage={
            deactivateMutation.error ? userFacingPatientError(deactivateMutation.error) : undefined
          }
          onConfirm={() => deactivateMutation.mutateAsync()}
        />
      </CardContent>
    </Card>
  );
}

function AddGuardianForm({
  patientId,
  linkedCustomerIds,
}: {
  readonly patientId: string;
  readonly linkedCustomerIds: readonly string[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const customers = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const [customerId, setCustomerId] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [success, setSuccess] = useState(false);

  const candidates = (customers.data ?? []).filter(
    (customer) => customer.isActive && !linkedCustomerIds.includes(customer.id)
  );

  const mutation = useMutation({
    mutationFn: () => createGuardian(patientId, { customerId, isPrimary }),
    onSuccess: () => {
      setCustomerId("");
      setIsPrimary(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ["patients", patientId, "guardians"] });
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mutation.error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {userFacingPatientError(mutation.error)}
        </div>
      )}
      {success && (
        <span role="status" className="text-sm text-status-success">
          Responsable vinculado.
        </span>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Cliente a vincular"
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          required
          disabled={mutation.isPending || customers.isLoading}
          className={selectClassName}
        >
          <option value="">Seleccioná un cliente</option>
          {candidates.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.displayName}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(event) => setIsPrimary(event.target.checked)}
            disabled={mutation.isPending}
            className="h-4 w-4 rounded border-input"
          />
          Responsable principal
        </label>
      </div>
      <Button type="submit" disabled={mutation.isPending || customerId === ""}>
        {mutation.isPending ? "Vinculando…" : "Vincular responsable"}
      </Button>
    </form>
  );
}

function GuardianItem({
  guardian,
  patientId,
  customers,
}: {
  readonly guardian: PatientGuardian;
  readonly patientId: string;
  readonly customers: readonly Customer[] | undefined;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["patients", patientId, "guardians"] });
  };
  const primaryMutation = useMutation({
    mutationFn: () => setPrimaryGuardian(patientId, guardian.id),
    onSuccess: invalidate,
  });
  const deactivateMutation = useMutation({
    mutationFn: () => deactivateGuardian(patientId, guardian.id),
    onSuccess: invalidate,
  });
  const error = primaryMutation.error ?? deactivateMutation.error;

  return (
    <div
      role="group"
      aria-label={`Responsable ${customerName(customers, guardian.customerId)}`}
      className="flex flex-col gap-3 rounded-md border bg-card p-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {customerName(customers, guardian.customerId)}
          {guardian.isPrimary && (
            <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
              Principal
            </span>
          )}
        </p>
        <p className="text-muted-foreground">
          {guardian.isActive ? `Posición ${guardian.position}` : "Inactivo"}
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {userFacingPatientError(error)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={primaryMutation.isPending || guardian.isPrimary || !guardian.isActive}
          onClick={() => primaryMutation.mutate()}
        >
          {primaryMutation.isPending ? "Actualizando…" : "Marcar principal"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={deactivateMutation.isPending || !guardian.isActive}
          onClick={() => setConfirmDeactivateOpen(true)}
        >
          {deactivateMutation.isPending ? "Desactivando…" : "Desactivar"}
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirmDeactivateOpen}
        onOpenChange={(open) => {
          if (!open && !deactivateMutation.isPending) setConfirmDeactivateOpen(false);
        }}
        title="Desvincular responsable"
        description="El cliente dejará de figurar como responsable de este paciente. Los registros clínicos no se eliminarán."
        confirmLabel="Desvincular"
        pendingLabel="Desvinculando…"
        pending={deactivateMutation.isPending}
        errorMessage={
          deactivateMutation.error ? userFacingPatientError(deactivateMutation.error) : undefined
        }
        onConfirm={() => deactivateMutation.mutateAsync()}
      />
    </div>
  );
}

function GuardianSection({ patientId }: { readonly patientId: string }): JSX.Element {
  const query = useQuery({
    queryKey: ["patients", patientId, "guardians"],
    queryFn: () => listGuardians(patientId),
  });
  const customers = useQuery({ queryKey: ["customers"], queryFn: listCustomers });
  const linkedCustomerIds = (query.data ?? []).map((guardian) => guardian.customerId);

  return (
    <SectionCard
      title="Responsables"
      description="Vinculá los clientes que están a cargo de este paciente."
    >
      <AddGuardianForm patientId={patientId} linkedCustomerIds={linkedCustomerIds} />
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando responsables…</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {userFacingPatientError(query.error)}
        </p>
      ) : query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay responsables vinculados.</p>
      ) : (
        <div className="space-y-2">
          {query.data?.map((guardian) => (
            <GuardianItem
              key={guardian.id}
              guardian={guardian}
              patientId={patientId}
              customers={customers.data}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Staff patient detail with guardian management.
 *
 * Permission checks are UX-only; the backend enforces the actual gates.
 * Patients and guardian links are tenant-scoped by the API, and this surface
 * never renders inside the Portal route group.
 */
export function PatientDetail({
  appointmentId,
  initialEncounterId,
}: { appointmentId?: string; initialEncounterId?: string } = {}): JSX.Element {
  const params = useParams<{ id: string }>();
  const patientId = params.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <Link
        href="/app/patients"
        className="inline-flex min-h-10 items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="chevron" className="rotate-180" />
        Volver a pacientes
      </Link>
      <PatientHeader patientId={patientId} />
      {appointmentId !== undefined && (
        <AppointmentJourney
          key={appointmentId}
          appointmentId={appointmentId}
          patientId={patientId}
        />
      )}
      <nav
        aria-label="Secciones del paciente"
        className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-card p-2"
      >
        {[
          ["#patient-overview", "Resumen"],
          ["#patient-clinical", "Ficha clínica"],
          ["#patient-prevention", "Vacunas y desparasitaciones"],
          ["#patient-treatments", "Tratamientos"],
          ["#patient-studies", "Estudios"],
          ["#patient-weights", "Pesos"],
          ["#patient-guardians", "Responsables"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="inline-flex min-h-10 shrink-0 items-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </a>
        ))}
      </nav>
      <PatientOverview patientId={patientId} />
      <section
        id="patient-clinical"
        aria-label="Atención clínica"
        className="scroll-mt-24 space-y-6"
        tabIndex={-1}
      >
        <ClinicalWorkspace
          patientId={patientId}
          appointmentId={appointmentId}
          initialEncounterId={initialEncounterId}
        />
      </section>
      <section
        id="patient-treatments"
        aria-label="Tratamientos del paciente"
        className="scroll-mt-24 rounded-lg border border-border bg-card p-5"
        tabIndex={-1}
      >
        <TreatmentList patientId={patientId} />
      </section>
      <section
        id="patient-studies"
        aria-label="Estudios del paciente"
        className="scroll-mt-24 rounded-lg border border-border bg-card p-5"
        tabIndex={-1}
      >
        <StudyList patientId={patientId} />
      </section>
      <section
        id="patient-weights"
        aria-label="Pesos del paciente"
        className="scroll-mt-24 rounded-lg border border-border bg-card p-5"
        tabIndex={-1}
      >
        <WeightList patientId={patientId} />
      </section>
      <section
        id="patient-guardians"
        aria-label="Gestión de responsables"
        className="scroll-mt-24"
        tabIndex={-1}
      >
        <GuardianSection patientId={patientId} />
      </section>
    </div>
  );
}
