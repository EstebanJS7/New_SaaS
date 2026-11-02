"use client";

import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
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
import { formatEsPyDateOnly } from "@/lib/es-py-format";
import { ErrorState } from "@/components/feedback";
import { usePatientExit } from "./patient-form-interaction";
import { listCustomers, customerError } from "../customers/customers-api";
import {
  getCatalog,
  patientWriteBlocked,
  userFacingPatientError,
  type Patient,
  type PatientSex,
} from "./patients-api";

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
  readonly onSubmit: (body: Record<string, unknown>) => Promise<unknown> | void;
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

  const catalog = useQuery({
    queryKey: ["patients", "catalog"],
    queryFn: getCatalog,
    retry: false,
  });
  const customers = useQuery({ queryKey: ["customers"], queryFn: listCustomers, retry: false });

  const breeds = catalog.data?.find((species) => species.id === values.speciesId)?.breeds ?? [];
  const activeCustomers = (customers.data ?? []).filter((customer) => customer.isActive);
  const guardianRequired = !isEdit && values.isActive;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const sending = useRef(false);
  const blocked = patientWriteBlocked(error);
  const unavailable = catalog.isPending || catalog.isError || !catalog.data?.length;
  const exit = usePatientExit(JSON.stringify(values) !== JSON.stringify(initialValues));
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      isPending ||
      sending.current ||
      blocked ||
      unavailable ||
      (guardianRequired && (customers.isPending || customers.isError))
    )
      return;
    const form = event.currentTarget;
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = "Ingresá el nombre.";
    else if (values.name.trim().length > 200) next.name = "Usá hasta 200 caracteres.";
    if (!values.speciesId) next.speciesId = "Seleccioná una especie.";
    if (guardianRequired && !values.primaryGuardianCustomerId)
      next.primaryGuardianCustomerId = "Seleccioná un responsable principal.";
    if (!form.querySelector<HTMLInputElement>("#birthDate")?.validity.valid)
      next.birthDate = "Revisá la fecha de nacimiento.";
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    const body = isEdit && patient ? buildUpdateBody(values, patient) : buildCreateBody(values);
    sending.current = true;
    try {
      await onSubmit(body);
    } catch {
      /* Mutation owner retains the values and presents the safe error. */
    } finally {
      sending.current = false;
    }
  }

  return (
    <Card lang="es-PY">
      <CardHeader>
        <CardTitle>
          <h1>{isEdit ? "Editar paciente" : "Nuevo paciente"}</h1>
        </CardTitle>
        <CardDescription>
          {isEdit
            ? "Actualizá los datos del paciente. Para activarlo debe tener un responsable principal activo."
            : "Registrá al paciente y, si está activo, su responsable principal."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {catalog.isPending && <p role="status">Cargando especies y razas…</p>}
        {catalog.error && (
          <ErrorState
            message={userFacingPatientError(catalog.error)}
            onRetry={() => void catalog.refetch()}
          />
        )}
        {catalog.isSuccess && !catalog.data.length && (
          <p role="status">
            No hay especies disponibles. Solicitá la revisión del catálogo antes de guardar.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
          >
            {userFacingPatientError(error)}
          </div>
        )}

        <form
          noValidate
          onSubmit={(event) => void handleSubmit(event)}
          onChange={() => setErrors({})}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Nombre (obligatorio)
            </label>
            <input
              id="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby="name-help"
              type="text"
              value={values.name}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, name: event.target.value }))
              }
              required
              disabled={isPending}
              placeholder="Nombre del paciente"
              className={inputClassName}
            />
            <p
              id="name-help"
              className={errors.name ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              {errors.name ?? "Hasta 200 caracteres."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="speciesId" className="text-sm font-medium">
                Especie (obligatorio)
              </label>
              <select
                id="speciesId"
                aria-invalid={Boolean(errors.speciesId)}
                aria-describedby="speciesId-help"
                value={values.speciesId}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    speciesId: event.target.value,
                    breedId: "",
                  }))
                }
                required
                disabled={isPending || unavailable}
                className={selectClassName}
              >
                <option value="">Seleccioná una especie</option>
                {(catalog.data ?? []).map((species) => (
                  <option key={species.id} value={species.id}>
                    {species.name}
                  </option>
                ))}
              </select>
              <p
                id="speciesId-help"
                className={
                  errors.speciesId ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {errors.speciesId ?? "Elegí una especie del catálogo disponible."}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="breedId" className="text-sm font-medium">
                Raza (opcional)
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
                <option value="">Sin raza informada</option>
                {breeds.map((breed) => (
                  <option key={breed.id} value={breed.id}>
                    {breed.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="sex" className="text-sm font-medium">
                Sexo
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
                <option value="UNKNOWN">Sin informar</option>
                <option value="MALE">Macho</option>
                <option value="FEMALE">Hembra</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="birthDate" className="text-sm font-medium">
                Fecha de nacimiento (opcional)
              </label>
              <input
                id="birthDate"
                aria-invalid={Boolean(errors.birthDate)}
                aria-describedby="birthDate-help"
                type="date"
                value={values.birthDate}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, birthDate: event.target.value }))
                }
                disabled={isPending}
                className={`${inputClassName} dark:[color-scheme:dark]`}
              />
              <p
                id="birthDate-help"
                className={
                  errors.birthDate ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {errors.birthDate ??
                  (values.birthDate
                    ? `Fecha seleccionada: ${formatEsPyDateOnly(values.birthDate)}. El control usa el formato del navegador.`
                    : "El control usa el formato del navegador. Se conserva el día seleccionado.")}
              </p>
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
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Paciente activo
          </label>

          {values.isActive && (
            <div className="space-y-2">
              <label htmlFor="primaryGuardianCustomerId" className="text-sm font-medium">
                Responsable principal {guardianRequired ? "(obligatorio)" : "(opcional)"}
              </label>
              <select
                id="primaryGuardianCustomerId"
                aria-invalid={Boolean(errors.primaryGuardianCustomerId)}
                aria-describedby="primaryGuardianCustomerId-help"
                value={values.primaryGuardianCustomerId}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    primaryGuardianCustomerId: event.target.value,
                  }))
                }
                required={guardianRequired}
                disabled={isPending || customers.isPending || customers.isError}
                className={selectClassName}
              >
                <option value="">
                  {isEdit ? "Conservar responsable principal actual" : "Seleccioná un cliente"}
                </option>
                {activeCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </option>
                ))}
              </select>
              <p
                id="primaryGuardianCustomerId-help"
                className={
                  errors.primaryGuardianCustomerId
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {errors.primaryGuardianCustomerId ?? "Clientes activos de esta organización."}
              </p>
              {customers.isPending && <p role="status">Cargando clientes…</p>}
              {customers.isSuccess && activeCustomers.length === 0 && (
                <p role="status">
                  No hay clientes activos disponibles. Registrá un cliente o guardá al paciente como
                  inactivo.
                </p>
              )}
              {customers.error && (
                <p role="alert" className="text-xs text-destructive">
                  {customerError(customers.error)}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void customers.refetch()}
                  >
                    Volver a cargar clientes
                  </button>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? "Seleccionar un cliente establece o reemplaza al responsable principal activo."
                  : "Un paciente activo siempre tiene exactamente un responsable principal activo."}
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Los cambios sin guardar se mantienen solo en esta pantalla. Recargar o salir los
            descarta.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-4">
            <Button
              type="submit"
              disabled={
                isPending ||
                blocked ||
                unavailable ||
                (guardianRequired && (customers.isPending || customers.isError))
              }
            >
              {isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear paciente"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                exit.leave(() =>
                  router.push(isEdit ? `/app/patients/${patient.id}` : "/app/patients")
                )
              }
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
        </form>
        {exit.dialog}
      </CardContent>
    </Card>
  );
}
