"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { getTreatment, searchTreatments } from "./treatment-search-api";
import { getStudy, searchStudies } from "./study-search-api";
import { getWeight, searchWeights } from "./weight-search-api";
import {
  clearRecordRecovery,
  deniedClinicalRead,
  type ClinicalRecordRecovery,
} from "./clinical-record-recovery";

export function ClinicalRecordRecoveryPanel({
  patientId,
  entry,
  onRecover,
  onDiscard,
}: {
  patientId: string;
  entry: ClinicalRecordRecovery;
  onRecover: (copy: ClinicalRecordRecovery) => void;
  onDiscard?: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const safeRetry =
    !entry.initial && Boolean(entry.fields.creation?.command) && entry.status === "uncertain";
  async function recover() {
    if (pending || (entry.status !== "draft" && !safeRetry)) return;
    setPending(true);
    setError(undefined);
    try {
      if (entry.expiresAt <= Date.now()) {
        clearRecordRecovery(client, patientId, entry.kind, entry.token);
        return;
      }
      if (!entry.initial) {
        const filters = { page: 1, period: "all", sort: "recent" } as const;
        if (entry.kind === "treatment") await searchTreatments(patientId, { ...filters, q: "" });
        else if (entry.kind === "study") await searchStudies(patientId, { ...filters, q: "" });
        else await searchWeights(patientId, filters);
      }
      let changed = false;
      if (entry.kind === "treatment" && entry.initial) {
        const current = await getTreatment(patientId, entry.initial.id);
        changed =
          current.id !== entry.initial.id ||
          current.version === undefined ||
          current.version !== entry.initial.version ||
          current.description !== entry.initial.description ||
          current.context !== entry.initial.context ||
          current.administeredAt !== entry.initial.administeredAt;
      } else if (entry.kind === "study" && entry.initial) {
        const current = await getStudy(patientId, entry.initial.id);
        changed =
          current.id !== entry.initial.id ||
          current.version === undefined ||
          current.version !== entry.initial.version ||
          current.studyType !== entry.initial.studyType ||
          current.result !== entry.initial.result ||
          current.performedAt !== entry.initial.performedAt;
      } else if (entry.kind === "weight" && entry.initial) {
        const current = await getWeight(patientId, entry.initial.id);
        changed =
          current.id !== entry.initial.id ||
          current.version === undefined ||
          current.version !== entry.initial.version ||
          current.quantity !== entry.initial.quantity ||
          current.unit !== entry.initial.unit ||
          current.measuredAt !== entry.initial.measuredAt;
      }
      if (!mounted.current) return;
      if (entry.expiresAt <= Date.now()) {
        clearRecordRecovery(client, patientId, entry.kind, entry.token);
        return;
      }
      if (changed) {
        setConflict(true);
        setError(
          "El registro cambió mientras estabas fuera. Revisá el detalle actual; estos cambios no se aplicarán automáticamente."
        );
        return;
      }
      onRecover(entry);
    } catch (failure) {
      if (deniedClinicalRead(failure))
        clearRecordRecovery(client, patientId, entry.kind, entry.token);
      else if (mounted.current)
        setError(
          "No pudimos comprobar el registro. Conservamos la copia temporal; volvé a intentar."
        );
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  const name =
    entry.kind === "treatment" ? "tratamiento" : entry.kind === "study" ? "estudio" : "peso";
  const fields: { label: string; value: string | boolean }[] =
    entry.kind === "treatment"
      ? [
          { label: "Descripción", value: entry.fields.description },
          { label: "Contexto", value: entry.fields.context },
          { label: "Fecha y hora de Paraguay", value: entry.fields.date },
        ]
      : entry.kind === "study"
        ? [
            { label: "Tipo de estudio", value: entry.fields.studyType },
            { label: "Resultado", value: entry.fields.result },
            { label: "Fecha y hora de Paraguay", value: entry.fields.date },
          ]
        : [
            { label: "Valor ingresado", value: entry.fields.quantity },
            { label: "Confirmación de kg", value: entry.fields.confirmedKg },
            { label: "Fecha y hora de Paraguay", value: entry.fields.date },
          ];
  if (entry.fields.correctionReason)
    fields.push({ label: "Motivo de la corrección", value: entry.fields.correctionReason });
  return (
    <section
      aria-label={"Cambios pendientes de " + name}
      className="space-y-3 rounded-md border border-border bg-card p-4"
    >
      <h3 className="font-semibold">
        Tenés {entry.fields.durable ? "un borrador guardado" : "una copia temporal"} de {name}
      </h3>
      <p className="text-sm text-muted-foreground">
        {entry.fields.durable
          ? "Borrador privado guardado en el servidor. Recuperarlo no guarda el registro; completarlo o descartarlo retira la copia recuperable sin borrar su contenido."
          : "La copia se conserva hasta diez minutos mientras navegás en esta pestaña. Recuperarla no guarda el registro."}
      </p>
      {safeRetry && (
        <p role="status">
          Podés recuperar el intento y confirmar su reintento con la misma clave y los mismos datos.
        </p>
      )}
      {entry.status !== "draft" && !safeRetry && (
        <p role="alert">
          {entry.status === "pending"
            ? "El guardado seguía en curso al salir. Esperá y revisá el listado antes de repetir la operación."
            : "No pudimos confirmar el guardado. Revisá el listado y el detalle antes de repetir la operación."}{" "}
          El reenvío está bloqueado.
        </p>
      )}
      {entry.kind === "weight" && (
        <p className="text-sm text-muted-foreground">
          {entry.initial?.unit === null && !entry.fields.confirmedKg
            ? "Unidad no especificada; kg sin confirmar."
            : "Unidad indicada en la copia: kg."}
        </p>
      )}
      {(entry.status !== "draft" || conflict) && (
        <dl className="space-y-2 text-sm">
          {fields.map(({ label, value }) => (
            <div key={label}>
              <dt className="font-medium">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">
                {typeof value === "boolean"
                  ? value
                    ? "Sí"
                    : "No"
                  : value.length === 0
                    ? "Sin texto"
                    : value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(entry.status === "draft" || safeRetry) && !conflict && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              void recover();
            }}
          >
            {pending
              ? "Comprobando registro…"
              : safeRetry
                ? "Recuperar para reintento seguro"
                : "Recuperar cambios"}
          </Button>
        )}
        <Button type="button" variant="outline" disabled={pending} onClick={() => setDiscard(true)}>
          {entry.fields.durable ? "Descartar borrador guardado" : "Descartar copia temporal"}
        </Button>
      </div>
      <ConfirmActionDialog
        open={discard}
        onOpenChange={setDiscard}
        title={entry.fields.durable ? "Descartar borrador guardado" : "Descartar copia temporal"}
        description={
          entry.fields.durable
            ? "El borrador dejará de estar disponible para recuperar, pero su contenido se conservará en el servidor. No cancela un guardado enviado ni modifica registros clínicos."
            : "Se eliminará esta copia de trabajo. Esto no cancela un guardado que ya se haya enviado ni modifica registros guardados."
        }
        confirmLabel="Descartar copia"
        cancelLabel="Conservar copia"
        onConfirm={async () => {
          if (onDiscard) await onDiscard();
          clearRecordRecovery(client, patientId, entry.kind, entry.token);
        }}
      />
    </section>
  );
}
