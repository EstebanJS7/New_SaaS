"use client";

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { listCustomers } from "../customers/customers-api";
import { getCatalog, type Patient, type PatientSex } from "./patients-api";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface PatientFormValues {
  name: string;
  speciesId: string;
  breedId: string;
  sex: PatientSex;
  birthDate: string;
  isActive: boolean;
  primaryGuardianCustomerId: string;
}

function emptyValues(): PatientFormValues {
  return {
    name: "",
    speciesId: "",
    breedId: "",
    sex: "UNKNOWN",
    birthDate: "",
    isActive: true,
    primaryGuardianCustomerId: "",
  };
}

function dateInputValue(birthDate: string | null): string {
  return birthDate ? birthDate.slice(0, 10) : "";
}

function toBirthDateIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function patientToValues(patient: Patient): PatientFormValues {
  return {
    name: patient.name,
    speciesId: patient.speciesId,
    breedId: patient.breedId ?? "",
    sex: patient.sex,
    birthDate: dateInputValue(patient.birthDate),
    isActive: patient.isActive,
    primaryGuardianCustomerId: "",
  };
}

function buildCreateBody(values: PatientFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: values.name.trim(),
    speciesId: values.speciesId,
    sex: values.sex,
    isActive: values.isActive,
  };

  if (values.breedId) body.breedId = values.breedId;
  if (values.birthDate) body.birthDate = toBirthDateIso(values.birthDate);
  if (values.primaryGuardianCustomerId) {
    body.primaryGuardianCustomerId = values.primaryGuardianCustomerId;
  }

  return body;
}

function buildUpdateBody(values: PatientFormValues, patient: Patient): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  const name = values.name.trim();
  if (name !== patient.name) body.name = name;

  const currentBreedId = patient.breedId ?? "";
  const speciesChanged = values.speciesId !== patient.speciesId;
  if (speciesChanged) body.speciesId = values.speciesId;
  if (speciesChanged || values.breedId !== currentBreedId) {
    body.breedId = values.breedId ? values.breedId : null;
  }

  if (values.sex !== patient.sex) body.sex = values.sex;

  const currentBirthDate = dateInputValue(patient.birthDate);
  if (values.birthDate !== currentBirthDate) {
    body.birthDate = values.birthDate ? toBirthDateIso(values.birthDate) : null;
  }

  if (values.isActive !== patient.isActive) body.isActive = values.isActive;
  if (values.primaryGuardianCustomerId) {
    body.primaryGuardianCustomerId = values.primaryGuardianCustomerId;
  }

  return body;
}

interface PatientFormProps {
  readonly patient?: Patient;
  readonly onSubmit: (body: Record<string, unknown>) => void;
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Shared create/edit form for Patients.
 *
 * The active-create contract requires a primary guardian (Decision #2223), so
 * the guardian select is required while `isActive` is checked on create. On
 * edit an optional guardian selection is used only to establish or replace the
 * primary guardian during reactivation. Species/Breed come from the GLOBAL
 * catalog; a breed list is scoped to the selected species.
 */
export function PatientForm({
  patient,
  onSubmit,
  isPending,
  error,
}: PatientFormProps): JSX.Element {
  const router = useRouter();
  const isEdit = patient !== undefined;
  const initialValues = useMemo(
    () => (patient ? patientToValues(patient) : emptyValues()),
    [patient]
  );
  const [values, setValues] = useState<PatientFormValues>(initialValues);

  const catalog = useQuery({ queryKey: ["patients", "catalog"], queryFn: getCatalog });
  const customers = useQuery({ queryKey: ["customers"], queryFn: listCustomers });

  const breeds = catalog.data?.find((species) => species.id === values.speciesId)?.breeds ?? [];
  const activeCustomers = (customers.data ?? []).filter((customer) => customer.isActive);
  const guardianRequired = !isEdit && values.isActive;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = isEdit && patient ? buildUpdateBody(values, patient) : buildCreateBody(values);
    onSubmit(body);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit patient" : "New patient"}</CardTitle>
        <CardDescription>
          {isEdit
            ? "Update patient identity. Activating an inactive patient requires a primary guardian."
            : "Create a patient and, when active, its primary guardian."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={values.name}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, name: event.target.value }))
              }
              required
              disabled={isPending}
              placeholder="Patient name"
              className={inputClassName}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="speciesId" className="text-sm font-medium">
                Species
              </label>
              <select
                id="speciesId"
                value={values.speciesId}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    speciesId: event.target.value,
                    breedId: "",
                  }))
                }
                required
                disabled={isPending || catalog.isLoading}
                className={selectClassName}
              >
                <option value="">Select species</option>
                {(catalog.data ?? []).map((species) => (
                  <option key={species.id} value={species.id}>
                    {species.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="breedId" className="text-sm font-medium">
                Breed
              </label>
              <select
                id="breedId"
                value={values.breedId}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, breedId: event.target.value }))
                }
                disabled={isPending || values.speciesId === ""}
                className={selectClassName}
              >
                <option value="">No breed</option>
                {breeds.map((breed) => (
                  <option key={breed.id} value={breed.id}>
                    {breed.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="sex" className="text-sm font-medium">
                Sex
              </label>
              <select
                id="sex"
                value={values.sex}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    sex: event.target.value as PatientSex,
                  }))
                }
                disabled={isPending}
                className={selectClassName}
              >
                <option value="UNKNOWN">Unknown</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="birthDate" className="text-sm font-medium">
                Birth date
              </label>
              <input
                id="birthDate"
                type="date"
                value={values.birthDate}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, birthDate: event.target.value }))
                }
                disabled={isPending}
                className={inputClassName}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, isActive: event.target.checked }))
              }
              disabled={isPending}
              className="h-4 w-4 rounded border-input"
            />
            Active
          </label>

          {values.isActive && (
            <div className="space-y-2">
              <label htmlFor="primaryGuardianCustomerId" className="text-sm font-medium">
                Primary guardian
              </label>
              <select
                id="primaryGuardianCustomerId"
                value={values.primaryGuardianCustomerId}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    primaryGuardianCustomerId: event.target.value,
                  }))
                }
                required={guardianRequired}
                disabled={isPending || customers.isLoading}
                className={selectClassName}
              >
                <option value="">
                  {isEdit ? "Keep current primary guardian" : "Select a customer"}
                </option>
                {activeCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </option>
                ))}
              </select>
              {customers.error && (
                <p role="alert" className="text-xs text-destructive">
                  {customers.error.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "Selecting a customer establishes or replaces the active primary guardian."
                  : "An active patient always has exactly one active primary guardian."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : isEdit ? "Save changes" : "Create patient"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
