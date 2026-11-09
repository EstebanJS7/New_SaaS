"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ListSkeleton } from "@/components/feedback";
import {
  declareIssuancePoint,
  fiscalSettingsErrorMessage,
  type EmitterProfile,
  type Establishment,
  type IssuancePoint,
  type IssuancePointDeclaration,
  type TimbradoRange,
} from "./fiscal-settings-api";
import {
  CREDIT_NOTE_DOCUMENT_TYPE,
  DOCUMENT_TYPE_OPTIONS,
  labelFor,
  pointLabel,
} from "./fiscal-settings-display";
import { SelectField, SuccessNotice } from "./fiscal-form-field";

/**
 * FISC-017's issuance point: which establishment, point and document type the
 * clinic issues with, chosen among its ACTIVE ranges. The API resolves the choice
 * to exactly one range and answers its `409`s with a sentence shown as is.
 */
export function IssuancePointSection({
  profile,
  establishments,
  ranges,
  isLoading,
  onDeclared,
}: {
  profile: EmitterProfile | null | undefined;
  establishments: readonly Establishment[];
  ranges: readonly TimbradoRange[] | undefined;
  isLoading: boolean;
  onDeclared: () => void;
}): JSX.Element {
  const titleId = useId();
  const [rangeId, setRangeId] = useState("");
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [declaration, setDeclaration] = useState<IssuancePointDeclaration | null>(null);

  const active = (ranges ?? []).filter((range) => range.status === "ACTIVE");
  const codeOf = (id: string) => establishments.find((item) => item.id === id)?.code ?? "";
  const declare = useMutation({
    mutationFn: (range: TimbradoRange) =>
      declareIssuancePoint({
        establishmentId: range.establishmentId,
        expeditionPoint: range.expeditionPoint,
        documentType: range.documentType,
      }),
    onSuccess: (result) => {
      setDeclaration(result);
      setNotice(`Se declaró el punto de expedición ${describePoint(result.issuancePoint)}.`);
      onDeclared();
    },
  });

  const current = declaration?.issuancePoint ?? profile?.issuancePoint ?? null;
  // The API's answer says whether the point has a credit-note range; once the
  // ranges are loaded the same fact is read from them, so a range added later
  // clears the warning without declaring again.
  const creditNoteMissing =
    current !== null &&
    (ranges === undefined
      ? declaration?.creditNoteRangeActive === false
      : !active.some(
          (range) =>
            range.documentType === CREDIT_NOTE_DOCUMENT_TYPE &&
            range.establishmentId === current.establishmentId &&
            range.expeditionPoint === current.expeditionPoint
        ));

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 id={titleId} className="text-base font-semibold">
          Punto de expedición
        </h2>
        <p className="text-sm text-muted-foreground">
          Con qué establecimiento, punto y tipo de documento factura la clínica.
        </p>
      </div>

      <SuccessNotice message={notice} />

      {isLoading ? <ListSkeleton label="Cargando punto de expedición…" rows={1} /> : null}

      {profile === null ? (
        <p className="text-sm text-muted-foreground">
          Primero guardá el perfil fiscal: el punto de expedición se declara en él.
        </p>
      ) : profile ? (
        <>
          <div className="text-sm">
            <p className="text-muted-foreground">Punto declarado</p>
            <p className="font-medium text-foreground">
              {current === null
                ? "Todavía no hay un punto de expedición declarado."
                : `${pointLabel(current.establishmentCode, current.expeditionPoint)} · ${labelFor(DOCUMENT_TYPE_OPTIONS, current.documentType)}`}
            </p>
          </div>

          {creditNoteMissing && current !== null ? (
            <p
              data-testid="credit-note-range-warning"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm"
            >
              {`No hay un timbrado activo de nota de crédito para ${pointLabel(current.establishmentCode, current.expeditionPoint)}: hasta que lo cargues, anular una venta facturada no podrá emitir la nota de crédito.`}
            </p>
          ) : null}

          {ranges === undefined ? null : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cargá un timbrado activo antes de declarar el punto de expedición.
            </p>
          ) : (
            <form
              noValidate
              aria-label="Declarar punto de expedición"
              aria-busy={declare.isPending}
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                setTouched(true);
                const range = active.find((candidate) => candidate.id === rangeId);
                if (range === undefined) return;
                setNotice(null);
                declare.mutate(range);
              }}
            >
              <SelectField
                label="Timbrado activo"
                value={rangeId}
                onChange={setRangeId}
                className="space-y-1 sm:col-span-2"
                emptyLabel="Elegí establecimiento, punto y tipo"
                error={touched && rangeId === "" ? "Elegí un timbrado activo." : null}
                options={active.map((range) => ({
                  code: range.id,
                  label: `${pointLabel(codeOf(range.establishmentId), range.expeditionPoint)} · ${labelFor(DOCUMENT_TYPE_OPTIONS, range.documentType)} · timbrado ${range.timbradoNumber}`,
                }))}
              />
              {declare.error ? (
                <p role="alert" className="text-sm text-destructive sm:col-span-3">
                  {fiscalSettingsErrorMessage(
                    declare.error,
                    "No se pudo declarar el punto de expedición. Intentá nuevamente."
                  )}
                </p>
              ) : null}
              <div className="sm:col-span-3">
                <Button type="submit" loading={declare.isPending}>
                  Declarar punto de expedición
                </Button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}

function describePoint(point: IssuancePoint): string {
  return `${pointLabel(point.establishmentCode, point.expeditionPoint)} (${labelFor(DOCUMENT_TYPE_OPTIONS, point.documentType)})`;
}
