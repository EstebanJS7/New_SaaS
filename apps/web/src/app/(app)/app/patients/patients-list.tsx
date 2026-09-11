"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  deactivatePatient,
  getCatalog,
  listPatients,
  userFacingPatientError,
  type Patient,
  type SpeciesCatalogEntry,
} from "./patients-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

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

function PatientCard({ patient }: { readonly patient: Patient }): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ["patients", "catalog"], queryFn: getCatalog });
  const mutation = useMutation({
    mutationFn: () => deactivatePatient(patient.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
    },
  });

  function handleDeactivate(): void {
    if (!window.confirm("Deactivate this patient?")) return;
    mutation.mutate();
  }

  return (
    <div className="flex items-start justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="min-w-0 space-y-1">
        <Link
          href={`/app/patients/${patient.id}`}
          className="truncate font-medium text-primary hover:underline"
        >
          {patient.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {speciesName(catalog.data, patient.speciesId)}
          {patient.breedId
            ? ` · ${breedName(catalog.data, patient.speciesId, patient.breedId)}`
            : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {patient.sex === "UNKNOWN" ? "Sex not recorded" : patient.sex}
          {patient.isActive ? "" : " · Inactive"}
        </p>
        {mutation.error && (
          <p role="alert" className="text-xs text-destructive">
            {userFacingPatientError(mutation.error)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.push(`/app/patients/${patient.id}/edit`)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDeactivate}
          disabled={mutation.isPending || !patient.isActive}
        >
          {mutation.isPending ? "Deactivating..." : "Deactivate"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Staff patient list with loading, empty, error, search, and deactivate states.
 *
 * Search is client-side over the tenant's active Patients because the WU3 read
 * surface exposes no search parameter; it never changes the API contract.
 * Permission checks are UX-only; the backend enforces the actual gates and
 * returns 403 when the staff role does not hold the required permission.
 */
export function PatientsList(): JSX.Element {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["patients"],
    queryFn: listPatients,
  });

  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (query.data ?? []).filter((patient) => patient.name.toLowerCase().includes(term)),
    [query.data, term]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground">
            Manage patient identity and their customer guardians.
          </p>
        </div>
        <Button type="button" asChild>
          <Link href="/app/patients/new">New patient</Link>
        </Button>
      </div>

      <div className="space-y-2">
        <label htmlFor="patient-search" className="text-sm font-medium">
          Search patients
        </label>
        <input
          id="patient-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by name"
          className={inputClassName}
        />
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Loading patients...</p>
          </CardContent>
        </Card>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          {userFacingPatientError(query.error)}
        </div>
      ) : query.data?.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No patients yet</CardTitle>
            <CardDescription>
              Get started by creating the first patient for this tenant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" asChild>
              <Link href="/app/patients/new">Create patient</Link>
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">No patients match “{search}”.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((patient) => (
            <PatientCard key={patient.id} patient={patient} />
          ))}
        </div>
      )}
    </div>
  );
}
