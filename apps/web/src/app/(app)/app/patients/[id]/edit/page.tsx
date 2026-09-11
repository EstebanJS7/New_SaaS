"use client";

import type { JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  });

  const mutation = useMutation({
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
        <p className="text-sm text-muted-foreground">Loading patient...</p>
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
      >
        {userFacingPatientError(query.error)}
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-muted-foreground">Patient not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PatientForm
        patient={query.data}
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
