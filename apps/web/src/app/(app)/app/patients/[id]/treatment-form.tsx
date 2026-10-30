"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRetainRecordForm, type TreatmentFields } from "./clinical-record-recovery";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { formatEsPyInstant } from "@/lib/es-py-format";
import { isoToLocalInput, localInputToIso } from "../../agenda/agenda-time";
import {
  getTreatment,
  userFacingTreatmentError,
  type TreatmentDetail,
} from "./treatment-search-api";
import {
  writeTreatment,
  TreatmentWriteError,
  type TreatmentWriteInput,
} from "./treatment-write-api";

export function TreatmentForm({
  patientId,
  initial,
  recovered,
  onSaved,
  onCancel,
}: {
  patientId: string;
  initial?: TreatmentDetail;
  recovered?: TreatmentFields;
  onSaved: (saved: TreatmentDetail) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const initialDate = initial === undefined ? "" : isoToLocalInput(initial.administeredAt);
  const [description, setDescription] = useState(
    recovered?.description ?? initial?.description ?? ""
  );
  const [date, setDate] = useState(recovered?.date ?? initialDate);
  const [context, setContext] = useState(recovered?.context ?? initial?.context ?? "");
  const [error, setError] = useState<string>();
  const [review, setReview] = useState<Partial<TreatmentWriteInput> | null>(null);
  const [discard, setDiscard] = useState(false);
  const [exitHref, setExitHref] = useState<string>();
  const [saving, setSaving] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const dirty =
    description !== (initial?.description ?? "") ||
    date !== initialDate ||
    context !== (initial?.context ?? "");
  const recovery = useRetainRecordForm(
    patientId,
    { kind: "treatment", initial, fields: { description, date, context } },
    dirty
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (!dirty && !saving && !uncertain) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const link = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const target = new URL(anchor.href);
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.search === location.search &&
        target.hash
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!inFlight.current) {
        setExitHref(anchor.href);
        setDiscard(true);
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", link, true);
    };
  }, [dirty, saving, uncertain]);
  function prepare() {
    setError(undefined);
    if (description.trim().length === 0 || description.length > 2000 || context.length > 10000) {
      setError("Ingresá una descripción de hasta 2000 caracteres y un contexto de hasta 10000.");
      return;
    }
    const input: Partial<TreatmentWriteInput> = {};
    if (description !== initial?.description) input.description = description;
    if (initial === undefined || context !== (initial.context ?? ""))
      input.context = context === "" ? null : context;
    if (initial === undefined || date !== initialDate) {
      try {
        input.administeredAt = localInputToIso(date);
      } catch {
        setError("Ingresá una fecha y hora válidas en el horario de Paraguay.");
        return;
      }
    }
    if (Object.keys(input).length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }
    setReview(input);
  }
  async function save() {
    if (inFlight.current || uncertain || review === null) return;
    inFlight.current = true;
    recovery.begin();
    setSaving(true);
    setError(undefined);
    try {
      if (initial !== undefined) {
        const current = await getTreatment(patientId, initial.id);
        if (
          (review.description !== undefined && current.description !== initial.description) ||
          (review.context !== undefined && current.context !== initial.context) ||
          (review.administeredAt !== undefined && current.administeredAt !== initial.administeredAt)
        ) {
          setError(
            "El tratamiento cambió desde que abriste el formulario. Conservamos tus cambios; volvé al detalle y revisá el registro antes de corregirlo."
          );
          throw new Error("STALE_TREATMENT");
        }
      }
      const saved = await writeTreatment(patientId, initial?.id, review);
      if (recovery.saved()) onSaved(saved);
    } catch (failure) {
      recovery.settled(failure);
      if (failure instanceof TreatmentWriteError && failure.uncertain) {
        setUncertain(true);
        setError(
          "No pudimos confirmar si se guardó. Revisá el listado antes de volver a registrar o corregir este tratamiento."
        );
      } else if (!(failure instanceof Error && failure.message === "STALE_TREATMENT")) {
        setError(
          failure instanceof TreatmentWriteError &&
            failure.status === 403 &&
            failure.code !== "FEATURE_NOT_ENTITLED"
            ? "No tenés permiso para guardar tratamientos."
            : failure instanceof TreatmentWriteError && failure.code === "VALIDATION_FAILED"
              ? "Revisá los campos del tratamiento e intentá de nuevo."
              : failure instanceof Error
                ? userFacingTreatmentError(failure)
                : "No pudimos guardar el tratamiento."
        );
      }
      throw failure;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      <h3
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initial === undefined ? "Registrar tratamiento" : "Corregir tratamiento"}
      </h3>
      {recovered && (
        <p role="status" className="text-sm text-muted-foreground">
          Recuperamos tus cambios temporales. Revisalos antes de guardar.
        </p>
      )}
      <form
        autoComplete="off"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          prepare();
        }}
      >
        <fieldset disabled={saving || review !== null || uncertain} className="space-y-4">
          <div>
            <label htmlFor="treatment-description" className="block text-sm font-medium">
              Descripción del tratamiento
            </label>
            <textarea
              id="treatment-description"
              required
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-3"
              aria-describedby="treatment-description-limit"
            />
            <p id="treatment-description-limit" className="text-sm text-muted-foreground">
              {description.length.toLocaleString("es-PY")} / 2000 caracteres
            </p>
          </div>
          <div>
            <label htmlFor="treatment-date" className="block text-sm font-medium">
              Fecha y hora de administración
            </label>
            <Input
              id="treatment-date"
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-describedby="treatment-date-help"
            />
            <p id="treatment-date-help" className="text-sm text-muted-foreground">
              Horario de Paraguay. Al editar esta fecha se guarda con precisión de minuto.
            </p>
          </div>
          <div>
            <label htmlFor="treatment-context" className="block text-sm font-medium">
              Contexto del tratamiento (opcional)
            </label>
            <textarea
              id="treatment-context"
              maxLength={10000}
              rows={4}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-3"
              aria-describedby="treatment-context-limit"
            />
            <p id="treatment-context-limit" className="text-sm text-muted-foreground">
              {context.length.toLocaleString("es-PY")} / 10.000 caracteres. Dejar vacío elimina el
              contexto al corregir.
            </p>
          </div>
        </fieldset>
        {error && !review && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving || uncertain || !dirty || review !== null}>
            {initial === undefined ? "Revisar tratamiento" : "Revisar corrección"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              if (uncertain) {
                recovery.discard();
                onCancel();
              } else if (dirty) setDiscard(true);
              else {
                recovery.discard();
                onCancel();
              }
            }}
          >
            {uncertain ? "Revisar listado o detalle" : "Cancelar"}
          </Button>
        </div>
      </form>
      <ConfirmActionDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) setReview(null);
        }}
        title={
          initial === undefined
            ? "Confirmar registro del tratamiento"
            : "Confirmar corrección del tratamiento"
        }
        description="Revisá los datos antes de guardar. Esta acción registra el tratamiento; no modifica consultas, ventas ni inventario."
        confirmLabel="Guardar tratamiento"
        cancelLabel="Volver al formulario"
        confirmVariant="default"
        confirmDisabled={uncertain}
        pending={saving}
        errorMessage={error}
        onConfirm={save}
      >
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-medium">Descripción</dt>
            <dd className="whitespace-pre-wrap break-words">{description}</dd>
          </div>
          <div>
            <dt className="font-medium">Administración</dt>
            <dd>
              {review?.administeredAt === undefined && initial !== undefined
                ? formatEsPyInstant(initial.administeredAt)
                : review?.administeredAt
                  ? formatEsPyInstant(review.administeredAt)
                  : ""}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Contexto</dt>
            <dd className="whitespace-pre-wrap break-words">
              {context || "Sin contexto registrado."}
            </dd>
          </div>
        </dl>
      </ConfirmActionDialog>
      <ConfirmActionDialog
        open={discard}
        onOpenChange={(open) => {
          setDiscard(open);
          if (!open) setExitHref(undefined);
        }}
        title="Descartar cambios del tratamiento"
        description="Los cambios sin guardar se perderán. El registro guardado no se modificará."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onConfirm={() => {
          recovery.discard();
          if (exitHref !== undefined) {
            const target = new URL(exitHref);
            if (target.origin === location.origin)
              router.push(`${target.pathname}${target.search}${target.hash}`);
            else window.location.assign(exitHref);
          } else onCancel();
        }}
      />
    </div>
  );
}
