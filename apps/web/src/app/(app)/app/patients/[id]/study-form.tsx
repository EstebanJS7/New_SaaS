"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRetainRecordForm, type StudyFields } from "./clinical-record-recovery";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { formatEsPyInstant } from "@/lib/es-py-format";
import { isoToLocalInput, localInputToIso } from "../../agenda/agenda-time";
import { getStudy, userFacingStudyError, type StudyDetail } from "./study-search-api";
import { writeStudy, StudyWriteError, type StudyWriteInput } from "./study-write-api";

export function StudyForm({
  patientId,
  initial,
  recovered,
  onSaved,
  onCancel,
}: {
  patientId: string;
  initial?: StudyDetail;
  recovered?: StudyFields;
  onSaved: (saved: StudyDetail) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const initialDate = initial === undefined ? "" : isoToLocalInput(initial.performedAt);
  const [studyType, setStudyType] = useState(recovered?.studyType ?? initial?.studyType ?? "");
  const [date, setDate] = useState(recovered?.date ?? initialDate);
  const [result, setResult] = useState(recovered?.result ?? initial?.result ?? "");
  const [error, setError] = useState<string>();
  const [review, setReview] = useState<Partial<StudyWriteInput> | null>(null);
  const [discard, setDiscard] = useState(false);
  const [exitHref, setExitHref] = useState<string>();
  const [saving, setSaving] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const dirty =
    studyType !== (initial?.studyType ?? "") ||
    date !== initialDate ||
    result !== (initial?.result ?? "");
  const recovery = useRetainRecordForm(
    patientId,
    { kind: "study", initial, fields: { studyType, date, result } },
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
    if (studyType.trim().length === 0 || studyType.length > 2000 || result.length > 10000) {
      setError(
        "Ingresá un tipo de estudio de hasta 2000 caracteres y un resultado de hasta 10000."
      );
      return;
    }
    const input: Partial<StudyWriteInput> = {};
    if (studyType !== initial?.studyType) input.studyType = studyType;
    if (result !== initial?.result) input.result = result;
    if (initial === undefined || date !== initialDate) {
      try {
        input.performedAt = localInputToIso(date);
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
        const current = await getStudy(patientId, initial.id);
        if (
          (review.studyType !== undefined && current.studyType !== initial.studyType) ||
          (review.result !== undefined && current.result !== initial.result) ||
          (review.performedAt !== undefined && current.performedAt !== initial.performedAt)
        ) {
          setError(
            "El estudio cambió desde que abriste el formulario. Conservamos tus cambios; volvé al detalle y revisá el registro antes de corregirlo."
          );
          throw new Error("STALE_STUDY");
        }
      }
      const saved = await writeStudy(patientId, initial?.id, review);
      if (recovery.saved()) onSaved(saved);
    } catch (failure) {
      recovery.settled(failure);
      if (failure instanceof StudyWriteError && failure.uncertain) {
        setUncertain(true);
        setError(
          "No pudimos confirmar si se guardó. Revisá el listado antes de volver a registrar o corregir este estudio."
        );
      } else if (!(failure instanceof Error && failure.message === "STALE_STUDY")) {
        setError(
          failure instanceof StudyWriteError &&
            failure.status === 403 &&
            failure.code !== "FEATURE_NOT_ENTITLED"
            ? "No tenés permiso para guardar estudios."
            : failure instanceof StudyWriteError && failure.code === "VALIDATION_FAILED"
              ? "Revisá los campos del estudio e intentá de nuevo."
              : failure instanceof Error
                ? userFacingStudyError(failure)
                : "No pudimos guardar el estudio."
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
        {initial === undefined ? "Registrar estudio" : "Corregir estudio"}
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
            <label htmlFor="study-type" className="block text-sm font-medium">
              Tipo de estudio
            </label>
            <textarea
              id="study-type"
              required
              maxLength={2000}
              rows={3}
              value={studyType}
              onChange={(e) => setStudyType(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-3"
              aria-describedby="study-type-limit"
            />
            <p id="study-type-limit" className="text-sm text-muted-foreground">
              {studyType.length.toLocaleString("es-PY")} / 2000 caracteres
            </p>
          </div>
          <div>
            <label htmlFor="study-date" className="block text-sm font-medium">
              Fecha y hora de realización
            </label>
            <Input
              id="study-date"
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-describedby="study-date-help"
            />
            <p id="study-date-help" className="text-sm text-muted-foreground">
              Horario de Paraguay. Al editar esta fecha se guarda con precisión de minuto.
            </p>
          </div>
          <div>
            <label htmlFor="study-result" className="block text-sm font-medium">
              Resultado del estudio (opcional)
            </label>
            <textarea
              id="study-result"
              maxLength={10000}
              rows={4}
              value={result}
              onChange={(e) => setResult(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-3"
              aria-describedby="study-result-limit"
            />
            <p id="study-result-limit" className="text-sm text-muted-foreground">
              {result.length.toLocaleString("es-PY")} / 10.000 caracteres. Dejar vacío guarda un
              resultado sin texto; no indica un estado clínico.
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
            {initial === undefined ? "Revisar estudio" : "Revisar corrección"}
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
            ? "Confirmar registro del estudio"
            : "Confirmar corrección del estudio"
        }
        description="Revisá los datos antes de guardar. Esta acción registra el estudio; no modifica consultas, ventas ni inventario."
        confirmLabel="Guardar estudio"
        cancelLabel="Volver al formulario"
        confirmVariant="default"
        confirmDisabled={uncertain}
        pending={saving}
        errorMessage={error}
        onConfirm={save}
      >
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-medium">Tipo de estudio</dt>
            <dd className="whitespace-pre-wrap break-words">{studyType}</dd>
          </div>
          <div>
            <dt className="font-medium">Realización</dt>
            <dd>
              {review?.performedAt === undefined && initial !== undefined
                ? formatEsPyInstant(initial.performedAt)
                : review?.performedAt
                  ? formatEsPyInstant(review.performedAt)
                  : ""}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Resultado</dt>
            <dd className="whitespace-pre-wrap break-words">
              {result || "Sin resultado registrado."}
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
        title="Descartar cambios del estudio"
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
