"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, lookupPatients, type PatientIdentity } from "../patients/patients-api";

export function patientLookupError(error: Error): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "FEATURE_NOT_ENTITLED") return "El módulo veterinario no está habilitado.";
    if (error.status === 403)
      return "Necesitás permisos de lectura de pacientes y clientes para ver nombres y responsables.";
    if (error.status === 401) return "Tu sesión terminó. Volvé a ingresar para buscar pacientes.";
  }
  return "No se pudieron cargar los pacientes. Intentá de nuevo.";
}

/** Resolve only IDs already visible through scheduling, never the patient list. */
export function usePatientIdentities(ids: readonly string[]) {
  const key = [...new Set(ids)].sort().join(",");
  return useQuery({
    queryKey: ["patients", "agenda-identities", key],
    enabled: key.length > 0,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<PatientIdentity[]> => {
      const values = key.split(",");
      const identities: PatientIdentity[] = [];
      for (let offset = 0; offset < values.length; offset += 50) {
        identities.push(
          ...(await lookupPatients({ ids: values.slice(offset, offset + 50) }, signal))
        );
      }
      return identities;
    },
  });
}
