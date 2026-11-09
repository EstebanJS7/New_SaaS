"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@newsaas/ui/components/ui/badge";
import { Button } from "@newsaas/ui/components/ui/button";
import { Icon } from "@newsaas/ui/components/ui/icon";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { formatEsPyDateOnly } from "@/lib/es-py-format";
import {
  createTimbradoRange,
  fiscalSettingsErrorMessage,
  retireTimbradoRange,
  type Establishment,
  type TimbradoRange,
  type TimbradoRangeInput,
} from "./fiscal-settings-api";
import {
  DOCUMENT_TYPE_OPTIONS,
  RANGE_STATUS_LABEL,
  labelFor,
  pointLabel,
  textareaClassName,
} from "./fiscal-settings-display";
import {
  SelectField,
  SuccessNotice,
  TextField,
  blankToNull,
  parseWhole,
} from "./fiscal-form-field";

/**
 * The timbrado ranges: list, add, and retire with a reason after an explicit
 * confirmation. Voiding numbers at SIFEN stays in the API on purpose (FISC-018).
 */
export function RangesSection({
  ranges,
  establishments,
  isLoading,
  error,
  onRetry,
  onSaved,
}: {
  ranges: readonly TimbradoRange[] | undefined;
  establishments: readonly Establishment[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onSaved: () => void;
}): JSX.Element {
  const titleId = useId();
  const reasonId = useId();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<TimbradoRange | null>(null);
  const [reason, setReason] = useState("");

  const retire = useMutation({
    mutationFn: ({ range, why }: { range: TimbradoRange; why: string }) =>
      retireTimbradoRange(range.id, why),
    onSuccess: (range) => {
      setNotice(`Se retiró el timbrado ${range.timbradoNumber}.`);
      setRetiring(null);
      onSaved();
    },
  });
  const codeOf = (id: string) =>
    establishments.find((item) => item.id === id)?.code ?? "Establecimiento";

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            Timbrados
          </h2>
          <p className="text-sm text-muted-foreground">
            Las numeraciones autorizadas por la SET para cada punto de expedición y tipo de
            documento.
          </p>
        </div>
        {error ? null : (
          <Button
            type="button"
            size="sm"
            aria-expanded={creating}
            onClick={() => {
              setNotice(null);
              setCreating((current) => !current);
            }}
          >
            <Icon name={creating ? "close" : "plus"} />
            {creating ? "Cerrar" : "Agregar timbrado"}
          </Button>
        )}
      </div>

      <SuccessNotice message={notice} />

      {creating ? (
        <RangeForm
          establishments={establishments}
          onCancel={() => setCreating(false)}
          onSaved={(range) => {
            setCreating(false);
            setNotice(`Se cargó el timbrado ${range.timbradoNumber}.`);
            onSaved();
          }}
        />
      ) : null}

      {isLoading ? <ListSkeleton label="Cargando timbrados…" rows={1} /> : null}
      {error ? (
        <ErrorState message="No se pudo cargar la lista de timbrados." onRetry={onRetry} />
      ) : null}

      {ranges && ranges.length > 0 ? (
        <ul className="space-y-3" aria-label="Timbrados cargados">
          {ranges.map((range) => (
            <li key={range.id} className="record-row" data-testid="range-row">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold text-foreground">
                    {labelFor(DOCUMENT_TYPE_OPTIONS, range.documentType)}
                  </span>
                  <Badge variant={range.status === "ACTIVE" ? "success" : "outline"}>
                    {RANGE_STATUS_LABEL[range.status] ?? range.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {`${pointLabel(codeOf(range.establishmentId), range.expeditionPoint)} · timbrado ${range.timbradoNumber}${range.series ? ` · serie ${range.series}` : ""}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Del ${range.rangeFrom} al ${range.rangeTo} · próximo ${range.nextNumber} · vigente desde ${formatEsPyDateOnly(range.validityStart)}`}
                </p>
              </div>
              {range.status === "ACTIVE" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    retire.reset();
                    setNotice(null);
                    setReason("");
                    setRetiring(range);
                  }}
                >
                  Retirar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : ranges ? (
        <EmptyState
          icon="receipt"
          title="Todavía no hay timbrados"
          description="Cargá el timbrado de facturas y el de notas de crédito de cada punto."
        />
      ) : null}

      <ConfirmActionDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null);
        }}
        title={retiring === null ? "" : `¿Retirar el timbrado ${retiring.timbradoNumber}?`}
        description="Deja de usarse para numerar documentos. No se puede reactivar: para seguir emitiendo en ese punto, cargá otro timbrado."
        confirmLabel="Retirar timbrado"
        confirmDisabled={reason.trim().length === 0}
        pending={retire.isPending}
        errorMessage={
          retire.error
            ? fiscalSettingsErrorMessage(retire.error, "No se pudo retirar el timbrado.")
            : undefined
        }
        // Rejects on failure on purpose: the dialog stays open and shows `errorMessage`.
        onConfirm={() =>
          retiring === null
            ? undefined
            : retire.mutateAsync({ range: retiring, why: reason.trim() })
        }
      >
        <div className="space-y-1">
          <label htmlFor={reasonId} className="text-sm font-medium">
            Motivo
          </label>
          <textarea
            id={reasonId}
            className={textareaClassName}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </ConfirmActionDialog>
    </section>
  );
}

interface RangeErrors {
  establishmentId?: string;
  expeditionPoint?: string;
  series?: string;
  timbradoNumber?: string;
  span?: string;
  validityStart?: string;
}

function RangeForm({
  establishments,
  onCancel,
  onSaved,
}: {
  establishments: readonly Establishment[];
  onCancel: () => void;
  onSaved: (range: TimbradoRange) => void;
}): JSX.Element {
  const [establishmentId, setEstablishmentId] = useState("");
  const [expeditionPoint, setExpeditionPoint] = useState("");
  const [documentType, setDocumentType] = useState("1");
  const [series, setSeries] = useState("");
  const [timbradoNumber, setTimbradoNumber] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [validityStart, setValidityStart] = useState("");
  const [errors, setErrors] = useState<RangeErrors>({});
  const save = useMutation({ mutationFn: createTimbradoRange, onSuccess: onSaved });

  function build(): TimbradoRangeInput | null {
    const next: RangeErrors = {};
    if (establishmentId === "") next.establishmentId = "Elegí el establecimiento.";
    if (!/^[0-9]{3}$/.test(expeditionPoint.trim()))
      next.expeditionPoint = "Tres dígitos, por ejemplo 001.";
    const seriesValue = blankToNull(series)?.toUpperCase() ?? null;
    if (seriesValue !== null && !/^[A-Z]{2}$/.test(seriesValue))
      next.series = "Dos letras, o dejalo vacío.";
    if (!/^0*[1-9][0-9]*$/.test(timbradoNumber.trim()) || timbradoNumber.trim().length !== 8)
      next.timbradoNumber = "Ocho dígitos.";
    const from = parseWhole(rangeFrom, 1, 9_999_999);
    const to = parseWhole(rangeTo, 1, 9_999_999);
    if (from === null || to === null || from > to)
      next.span = "Números del 1 al 9.999.999, y el inicial no mayor que el final.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validityStart) || validityStart < "2018-05-01")
      next.validityStart = "Una fecha desde el 01/05/2018.";
    setErrors(next);
    if (Object.keys(next).length > 0 || from === null || to === null) return null;
    return {
      establishmentId,
      expeditionPoint: expeditionPoint.trim(),
      documentType: Number(documentType),
      series: seriesValue,
      timbradoNumber: timbradoNumber.trim(),
      rangeFrom: from,
      rangeTo: to,
      validityStart,
    };
  }

  return (
    <form
      noValidate
      aria-label="Nuevo timbrado"
      aria-busy={save.isPending}
      className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const input = build();
        if (input !== null) save.mutate(input);
      }}
    >
      <h3 className="text-sm font-semibold sm:col-span-3">Nuevo timbrado</h3>
      <SelectField
        label="Establecimiento"
        value={establishmentId}
        onChange={setEstablishmentId}
        options={establishments.map((item) => ({
          code: item.id,
          label: `${item.code} · ${item.addressLine}`,
        }))}
        emptyLabel="Elegí un establecimiento"
        error={errors.establishmentId}
      />
      <TextField
        label="Punto de expedición"
        value={expeditionPoint}
        onChange={setExpeditionPoint}
        error={errors.expeditionPoint}
        inputMode="numeric"
        maxLength={3}
        placeholder="001"
      />
      <SelectField
        label="Tipo de documento"
        value={documentType}
        onChange={setDocumentType}
        options={DOCUMENT_TYPE_OPTIONS}
      />
      <TextField
        label="Número de timbrado"
        value={timbradoNumber}
        onChange={setTimbradoNumber}
        error={errors.timbradoNumber}
        inputMode="numeric"
        maxLength={8}
      />
      <TextField
        label="Serie"
        value={series}
        onChange={setSeries}
        error={errors.series}
        optional
        maxLength={2}
      />
      <TextField
        label="Inicio de vigencia"
        type="date"
        value={validityStart}
        onChange={setValidityStart}
        error={errors.validityStart}
      />
      <TextField
        label="Desde el número"
        value={rangeFrom}
        onChange={setRangeFrom}
        error={errors.span}
        inputMode="numeric"
        maxLength={7}
      />
      <TextField
        label="Hasta el número"
        value={rangeTo}
        onChange={setRangeTo}
        inputMode="numeric"
        maxLength={7}
      />
      {save.error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {fiscalSettingsErrorMessage(
            save.error,
            "No se pudo cargar el timbrado. Intentá nuevamente."
          )}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={save.isPending}>
          Guardar timbrado
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
