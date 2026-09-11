"use client";

import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PatientForm } from "../patient-form";
import { createPatient } from "../patients-api";

/**
 * Staff create-patient page.
 */
export default function NewPatientPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: createPatient,
    onSuccess: (patient) => {
      queryClient.setQueryData(["patients"], (previous: unknown) => {
        const list = (previous as { id: string }[] | undefined) ?? [];
        return [patient, ...list];
      });
      router.push(`/app/patients/${patient.id}`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PatientForm
        onSubmit={(body) => mutation.mutate(body)}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  );
}
