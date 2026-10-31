"use client";
import { useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { formatEsPyInstant, formatEsPyDecimalInput } from "@/lib/es-py-format";
import { getTreatment } from "./treatment-search-api";
import { getStudy } from "./study-search-api";
import { getWeight } from "./weight-search-api";
import type { ClinicalRecordKind } from "./clinical-record-recovery";

/** Read-only current state alongside the retained working copy. Never rebases or writes. */
export function ClinicalCorrectionConflict({
  patientId,
  kind,
  id,
}: {
  patientId: string;
  kind: ClinicalRecordKind;
  id: string;
}) {
  const [fields, setFields] = useState<{ label: string; value: string }[]>();
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  async function read() {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setFields(undefined);
    try {
      if (kind === "treatment") {
        const row = await getTreatment(patientId, id);
        setFields([
          { label: "Descripción actual", value: row.description },
          { label: "Contexto actual", value: row.context ?? "Sin contexto registrado." },
          { label: "Administración actual", value: formatEsPyInstant(row.administeredAt) },
        ]);
      } else if (kind === "study") {
        const row = await getStudy(patientId, id);
        setFields([
          { label: "Tipo actual", value: row.studyType },
          { label: "Resultado actual", value: row.result || "Sin resultado registrado." },
          { label: "Realización actual", value: formatEsPyInstant(row.performedAt) },
        ]);
      } else {
        const row = await getWeight(patientId, id);
        setFields([
          {
            label: "Peso actual del registro",
            value:
              formatEsPyDecimalInput(row.quantity) +
              (row.unit === "KG" ? " kg" : " — unidad no especificada"),
          },
          { label: "Medición actual", value: formatEsPyInstant(row.measuredAt) },
        ]);
      }
    } catch {
      setError("No pudimos consultar el registro actual. Revisá tu acceso y volvé a intentar.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-label="Conflicto de corrección"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <p role="status">
        Tus cambios siguen en el formulario. Consultá el registro actual; para corregirlo, cancelá
        esta copia y abrí una nueva corrección desde el detalle actualizado.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          void read();
        }}
      >
        {pending ? "Consultando registro…" : "Consultar registro actual"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {fields && (
        <dl className="space-y-2 text-sm">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="font-medium">{field.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
