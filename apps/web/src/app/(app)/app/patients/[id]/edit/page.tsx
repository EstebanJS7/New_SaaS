"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/feedback";
import { PatientForm } from "../../patient-form";
import { getPatient, updatePatient, userFacingPatientError } from "../../patients-api";

/**
 * Staff edit-patient page.
 */
export default function EditPatientPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const query = useQuery({
    queryKey: ["patients", id],
    queryFn: () => getPatient(id),
    retry: false,
  });

  const mutation = useMutation({
    retry: false,
    mutationFn: (body: Record<string, unknown>) => updatePatient(id, body),
    onSuccess: (patient) => {
      queryClient.setQueryData(["patients", id], patient);
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
      router.push(`/app/patients/${patient.id}`);
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Cargando paciente…</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorState
          message={userFacingPatientError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">No encontramos el paciente.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PatientForm
        patient={query.data}
        onSubmit={(body) => mutation.mutateAsync(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
