"use client";

import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { listCustomers, type Customer } from "../../customers/customers-api";
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
  return customers?.find((customer) => customer.id === customerId)?.displayName ?? customerId;
}

function speciesName(catalog: readonly SpeciesCatalogEntry[] | undefined, id: string): string {
  return catalog?.find((species) => species.id === id)?.name ?? "Unknown species";
}

function breedName(
  catalog: readonly SpeciesCatalogEntry[] | undefined,
  speciesId: string,
  breedId: string
): string {
  return (
    catalog
      ?.find((species) => species.id === speciesId)
      ?.breeds.find((breed) => breed.id === breedId)?.name ?? "Unknown breed"
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

function PatientHeader({ patientId }: { readonly patientId: string }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
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

  function handleDeactivate(): void {
    if (!window.confirm("Deactivate this patient?")) return;
    deactivateMutation.mutate();
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading patient...</p>;
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
    return <p className="text-sm text-muted-foreground">Patient not found.</p>;
  }

  const species = speciesName(catalog.data, patient.speciesId);
  const breed = patient.breedId
    ? ` · ${breedName(catalog.data, patient.speciesId, patient.breedId)}`
    : "";

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{patient.name}</h1>
            <p className="text-sm text-muted-foreground">
              {species}
              {breed} · {patient.sex === "UNKNOWN" ? "Sex not recorded" : patient.sex}
            </p>
            {patient.birthDate && (
              <p className="text-sm text-muted-foreground">Born {patient.birthDate.slice(0, 10)}</p>
            )}
            {!patient.isActive && <p className="text-sm text-muted-foreground">Inactive</p>}
            {deactivateMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {userFacingPatientError(deactivateMutation.error)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/app/patients/${patient.id}/edit`)}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={deactivateMutation.isPending || !patient.isActive}
              onClick={handleDeactivate}
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate"}
            </Button>
          </div>
        </div>
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
      {success && <span className="text-sm text-status-success">Guardian linked.</span>}
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          required
          disabled={mutation.isPending || customers.isLoading}
          className={selectClassName}
        >
          <option value="">Select a customer</option>
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
          Primary guardian
        </label>
      </div>
      <Button type="submit" disabled={mutation.isPending || customerId === ""}>
        {mutation.isPending ? "Linking..." : "Link guardian"}
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
    <div className="flex items-start justify-between rounded-md border bg-card p-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {customerName(customers, guardian.customerId)}
          {guardian.isPrimary && (
            <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
              Primary
            </span>
          )}
        </p>
        <p className="text-muted-foreground">
          {guardian.isActive ? `Position ${guardian.position}` : "Inactive"}
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {userFacingPatientError(error)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={primaryMutation.isPending || guardian.isPrimary || !guardian.isActive}
          onClick={() => primaryMutation.mutate()}
        >
          {primaryMutation.isPending ? "Promoting..." : "Make primary"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={deactivateMutation.isPending || !guardian.isActive}
          onClick={() => deactivateMutation.mutate()}
        >
          {deactivateMutation.isPending ? "Deactivating..." : "Deactivate"}
        </Button>
      </div>
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
      title="Guardians"
      description="Link Core Customers who are responsible for this patient."
    >
      <AddGuardianForm patientId={patientId} linkedCustomerIds={linkedCustomerIds} />
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading guardians...</p>
      ) : query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {userFacingPatientError(query.error)}
        </p>
      ) : query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No guardians yet.</p>
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
export function PatientDetail(): JSX.Element {
  const params = useParams<{ id: string }>();
  const patientId = params.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PatientHeader patientId={patientId} />
      <GuardianSection patientId={patientId} />
    </div>
  );
}
