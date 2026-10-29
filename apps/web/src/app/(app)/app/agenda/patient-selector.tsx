"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { lookupPatients, type PatientIdentity } from "../patients/patients-api";
import { patientLookupError } from "./patient-lookup";

interface PatientSelectorProps {
  readonly value: PatientIdentity | null;
  readonly onChange: (patient: PatientIdentity | null) => void;
  readonly disabled: boolean;
  readonly invalid: boolean;
}

/** Native search/radio controls preserve keyboard behavior without a custom combobox. */
export function PatientSelector({ value, onChange, disabled, invalid }: PatientSelectorProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timeout);
  }, [term]);
  const query = useQuery({
    queryKey: ["patients", "agenda-search", debounced],
    queryFn: ({ signal }) => lookupPatients({ q: debounced }, signal),
    enabled: value === null && debounced.length >= 2,
    retry: false,
    gcTime: 0,
  });
  const current = term.trim() === debounced;

  return (
    <fieldset
      className="space-y-2 rounded-lg border bg-background p-3 sm:col-span-2"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">
        Paciente <span aria-hidden="true">*</span>
      </legend>
      {value !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{value.name}</p>
            <p className="text-xs text-muted-foreground">
              {value.speciesName} · Responsable principal:{" "}
              {value.primaryGuardianName ?? "No disponible"}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setTerm("");
              onChange(null);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            Cambiar paciente
          </Button>
        </div>
      ) : (
        <>
          <label htmlFor={`${id}-search`} className="sr-only">
            Buscar paciente
          </label>
          <input
            ref={input}
            id={`${id}-search`}
            type="search"
            autoComplete="off"
            maxLength={80}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Nombre del paciente o de su responsable principal"
            aria-invalid={invalid}
            aria-describedby={`${id}-help${invalid ? " appointment-validation" : ""}`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            Escribí al menos 2 caracteres y seleccioná un resultado. Se muestran hasta 20 pacientes
            activos.
          </p>
          {(!current || query.isFetching) && term.trim().length >= 2 && (
            <p role="status" className="text-sm text-muted-foreground">
              Buscando pacientes…
            </p>
          )}
          {current && query.error && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{patientLookupError(query.error)}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void query.refetch();
                }}
              >
                Reintentar búsqueda
              </Button>
            </div>
          )}
          {current && debounced.length >= 2 && query.isSuccess && query.data.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              No encontramos pacientes. Probá con otro nombre o revisá el responsable principal.
            </p>
          )}
          {current &&
            !query.isFetching &&
            !query.isError &&
            query.data !== undefined &&
            query.data.length > 0 && (
              <div
                className="max-h-64 space-y-1 overflow-y-auto"
                role="radiogroup"
                aria-label="Resultados de pacientes"
              >
                {query.data.map((patient) => (
                  <label
                    key={patient.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent focus-within:ring-1 focus-within:ring-ring"
                  >
                    <input
                      type="radio"
                      name={`${id}-patient`}
                      value={patient.id}
                      onChange={() => onChange(patient)}
                      className="mt-1 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{patient.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {patient.speciesName} · Responsable principal:{" "}
                        {patient.primaryGuardianName ?? "No disponible"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
        </>
      )}
    </fieldset>
  );
}
