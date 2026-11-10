"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PatientForm } from "../patient-form";
import { createPatient } from "../patients-api";
import { useCan } from "@/lib/capabilities";
import { PATIENT_ACTIONS, PatientsNoAccess } from "../patient-capabilities";

/**
 * Staff create-patient page.
 */
export default function NewPatientPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreate = useCan(PATIENT_ACTIONS.create);

  const mutation = useMutation({
    retry: false,
    mutationFn: createPatient,
    onSuccess: (patient) => {
      queryClient.setQueryData(["patients"], (previous: unknown) => {
        const list = (previous as { id: string }[] | undefined) ?? [];
        return [patient, ...list];
      });
      router.push(`/app/patients/${patient.id}`);
    },
  });

  if (!canCreate) {
    return (
      <div className="mx-auto max-w-2xl">
        <PatientsNoAccess title="No tenés permiso para crear pacientes" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PatientForm
        onSubmit={(body) => mutation.mutateAsync(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
