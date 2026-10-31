"use client";
import { ClinicalDraftSave } from "./clinical-server-drafts";
import { ClinicalCorrectionConflict } from "./clinical-correction-conflict";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRetainRecordForm, type WeightFields } from "./clinical-record-recovery";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { parseWeightRange } from "./weight-filter-input";
import { formatEsPyDecimal, formatEsPyDecimalInput, formatEsPyInstant } from "@/lib/es-py-format";
import { isoToLocalInput, localInputToIso } from "../../agenda/agenda-time";
import { getWeight, userFacingWeightError, type WeightDetail } from "./weight-search-api";
import { writeWeight, WeightWriteError, type WeightWriteInput } from "./weight-write-api";

function canonicalQuantity(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(3, "0")}`;
}

export function WeightForm({
  patientId,
  initial,
  recovered,
  onSaved,
  onCancel,
}: {
  patientId: string;
  initial?: WeightDetail;
  recovered?: WeightFields;
  onSaved: (saved: WeightDetail) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const creation = useRef<import("./clinical-record-recovery").CreationAttempt<WeightWriteInput>>(
    recovered?.creation ?? { key: crypto.randomUUID() }
  );
  const initialDate = initial === undefined ? "" : isoToLocalInput(initial.measuredAt);
  const [quantity, setQuantity] = useState(
    recovered?.quantity ?? formatEsPyDecimalInput(initial?.quantity ?? "")
  );
  const [confirmedKg, setConfirmedKg] = useState(recovered?.confirmedKg ?? false);
  const [date, setDate] = useState(recovered?.date ?? initialDate);
  const [correctionReason, setCorrectionReason] = useState(recovered?.correctionReason ?? "");
  const [error, setError] = useState<string>();
  const [conflicted, setConflicted] = useState(false);
  const [review, setReview] = useState<Partial<WeightWriteInput> | null>(null);
  const [discard, setDiscard] = useState(false);
  const [exitHref, setExitHref] = useState<string>();
  const [saving, setSaving] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const dirty =
    correctionReason !== "" ||
    quantity !== formatEsPyDecimalInput(initial?.quantity ?? "") ||
    date !== initialDate ||
    confirmedKg;
  const recovery = useRetainRecordForm(
    patientId,
    {
      kind: "weight",
      initial,
      fields: {
        durable: recovered?.durable,
        correctionReason,
        quantity,
        date,
        confirmedKg,
        ...(initial === undefined && { creation: creation.current }),
      },
    },
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
    if (recovery.draft.blocked) return;
    if (initial === undefined && creation.current.command) {
      setReview(creation.current.command);
      return;
    }
    setError(undefined);
    const parsed = parseWeightRange(quantity, "");
    if (!parsed.ok || parsed.value.minQuantity === undefined) {
      setError(
        "Ingresá un peso positivo con hasta 7 dígitos enteros y 3 decimales, usando coma decimal."
      );
      return;
    }
    const value = canonicalQuantity(parsed.value.minQuantity);
    const changedQuantity = initial === undefined || value !== canonicalQuantity(initial.quantity);
    if (initial?.unit === null && changedQuantity && !confirmedKg) {
      setError("Confirmá que el valor que vas a guardar está expresado en kg antes de corregirlo.");
      return;
    }
    const input: Partial<WeightWriteInput> = {};
    if (changedQuantity) input.quantity = value;
    if (initial === undefined || (changedQuantity && initial.unit === "KG") || confirmedKg)
      input.unit = "KG";
    if (initial === undefined || date !== initialDate) {
      try {
        input.measuredAt = localInputToIso(date);
      } catch {
        setError("Ingresá una fecha y hora válidas en el horario de Paraguay.");
        return;
      }
    }
    if (Object.keys(input).length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }
    if (initial !== undefined) {
      if (correctionReason.trim().length === 0 || correctionReason.length > 2000) {
        setError("Ingresá el motivo de la corrección (hasta 2000 caracteres).");
        return;
      }
      input.correctionReason = correctionReason;
    }
    setReview(input);
  }
  async function save() {
    if (recovery.draft.blocked) return;
    if (inFlight.current || uncertain || conflicted || review === null) return;
    inFlight.current = true;
    recovery.begin();
    setSaving(true);
    setError(undefined);
    try {
      if (initial !== undefined) {
        if (
          !Number.isInteger(initial.version) ||
          initial.version! < 1 ||
          initial.version! > 2147483647
        ) {
          setError(
            "No pudimos comprobar la versión del registro. Volvé al detalle antes de corregirlo."
          );
          setConflicted(true);
          throw new Error("STALE_WEIGHT");
        }
        const current = await getWeight(patientId, initial.id);
        if (
          current.version !== initial.version ||
          ((review.quantity !== undefined || review.unit !== undefined) &&
            (current.quantity !== initial.quantity || current.unit !== initial.unit)) ||
          (review.measuredAt !== undefined && current.measuredAt !== initial.measuredAt)
        ) {
          setError(
            "El peso cambió desde que abriste el formulario. Conservamos tus cambios; volvé al detalle y revisá el registro antes de corregirlo."
          );
          throw new Error("STALE_WEIGHT");
        }
      }
      if (initial === undefined) creation.current.command ??= { ...review };
      const saved =
        initial === undefined
          ? await writeWeight(
              patientId,
              undefined,
              { ...creation.current.command!, draft: recovery.draft.reference },
              creation.current
            )
          : await writeWeight(patientId, initial.id, {
              ...review,
              draft: recovery.draft.reference,
              expectedVersion: initial.version!,
              correctionReason: review.correctionReason!,
            });
      if (recovery.saved()) onSaved(saved);
    } catch (failure) {
      recovery.settled(failure);
      if (failure instanceof Error && failure.message === "STALE_WEIGHT") setConflicted(true);
      if (
        initial !== undefined &&
        failure instanceof WeightWriteError &&
        failure.code === "CONFLICT"
      )
        setConflicted(true);
      if (failure instanceof WeightWriteError && failure.uncertain) {
        setUncertain(initial !== undefined);
        setError(
          initial === undefined
            ? "No pudimos completar la confirmación. Podés reintentar con la misma clave y los mismos datos sin duplicar el registro. Si el peso ya se confirmó, solo se reintentará su lectura."
            : "No pudimos confirmar si se guardó. Revisá el listado antes de volver a registrar o corregir este peso."
        );
      } else if (!(failure instanceof Error && failure.message === "STALE_WEIGHT")) {
        setError(
          failure instanceof WeightWriteError &&
            failure.status === 403 &&
            failure.code !== "FEATURE_NOT_ENTITLED"
            ? "No tenés permiso para guardar pesos."
            : failure instanceof WeightWriteError && failure.code === "CONFLICT"
              ? initial === undefined
                ? "La clave ya se usó con otros datos. Revisá el registro original antes de continuar."
                : "El registro cambió. Conservamos tus cambios; revisá el registro actual antes de iniciar otra corrección."
              : failure instanceof WeightWriteError && failure.code === "VALIDATION_FAILED"
                ? "Revisá los campos del peso e intentá de nuevo."
                : failure instanceof Error
                  ? userFacingWeightError(failure)
                  : "No pudimos guardar el peso."
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
        {initial === undefined ? "Registrar peso" : "Corregir peso"}
      </h3>
      {recovered && (
        <p role="status" className="text-sm text-muted-foreground">
          {recovered.durable
            ? "Recuperamos tu borrador guardado en el servidor. Revisalo antes de guardar."
            : "Recuperamos tus cambios temporales. Revisalos antes de guardar."}
        </p>
      )}
      {conflicted && initial && (
        <ClinicalCorrectionConflict patientId={patientId} kind="weight" id={initial.id} />
      )}
      <form
        autoComplete="off"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          prepare();
        }}
      >
        <fieldset
          disabled={
            recovery.draft.saving ||
            saving ||
            review !== null ||
            uncertain ||
            (initial === undefined && Boolean(creation.current.command))
          }
          className="space-y-4"
        >
          <div>
            <label htmlFor="weight-quantity" className="block text-sm font-medium">
              {initial?.unit === null ? "Valor registrado (unidad no especificada)" : "Peso (kg)"}
            </label>
            <Input
              id="weight-quantity"
              inputMode="decimal"
              required
              maxLength={20}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-describedby="weight-quantity-help"
            />
            <p id="weight-quantity-help" className="text-sm text-muted-foreground">
              Valor positivo, coma decimal y hasta 3 decimales. No se realiza conversión de
              unidades.
            </p>
          </div>
          {initial?.unit === null && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmedKg}
                onChange={(e) => setConfirmedKg(e.target.checked)}
              />
              <span>Confirmo que el valor que voy a guardar está expresado en kg.</span>
            </label>
          )}
          <div>
            <label htmlFor="weight-date" className="block text-sm font-medium">
              Fecha y hora de medición
            </label>
            <Input
              id="weight-date"
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-describedby="weight-date-help"
            />
            <p id="weight-date-help" className="text-sm text-muted-foreground">
              Horario de Paraguay. Al editar esta fecha se guarda con precisión de minuto.
            </p>
          </div>
        </fieldset>
        {error && !review && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {initial !== undefined && (
          <div>
            <label htmlFor="weight-correction-reason" className="block text-sm font-medium">
              Motivo de la corrección
            </label>
            <textarea
              id="weight-correction-reason"
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              maxLength={2000}
              required
              disabled={saving || uncertain || conflicted}
              className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Explicá por qué corregís este registro. Se conservará en el historial.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              recovery.draft.blocked ||
              saving ||
              uncertain ||
              conflicted ||
              !dirty ||
              review !== null
            }
          >
            {initial === undefined ? "Revisar peso" : "Revisar corrección"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving || recovery.draft.saving}
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
      <ClinicalDraftSave
        draft={recovery.draft}
        disabled={saving || review !== null || uncertain || conflicted}
      />
      <ConfirmActionDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) setReview(null);
        }}
        title={
          initial === undefined ? "Confirmar registro del peso" : "Confirmar corrección del peso"
        }
        description="Revisá los datos antes de guardar. Esta acción registra el peso; no modifica consultas, ventas ni inventario."
        confirmLabel="Guardar peso"
        cancelLabel="Volver al formulario"
        confirmVariant="default"
        confirmDisabled={recovery.draft.blocked || uncertain || conflicted}
        pending={saving}
        errorMessage={error}
        onConfirm={save}
      >
        <dl className="space-y-2 text-sm">
          {initial !== undefined && (
            <div>
              <dt className="font-medium">Motivo de la corrección</dt>
              <dd className="whitespace-pre-wrap break-words">{review?.correctionReason}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium">Valor</dt>
            <dd>
              {review?.quantity
                ? formatEsPyDecimal(review.quantity)
                : initial
                  ? formatEsPyDecimal(initial.quantity)
                  : quantity}{" "}
              {review?.unit === "KG" || initial?.unit === "KG" ? "kg" : "(unidad no especificada)"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Medición</dt>
            <dd>
              {review?.measuredAt === undefined && initial !== undefined
                ? formatEsPyInstant(initial.measuredAt)
                : review?.measuredAt
                  ? formatEsPyInstant(review.measuredAt)
                  : ""}
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
        title="Descartar cambios del peso"
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
