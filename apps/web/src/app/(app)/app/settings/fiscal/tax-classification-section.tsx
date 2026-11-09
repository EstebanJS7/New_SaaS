"use client";
import { useId, useState, type JSX } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/feedback";
import { fiscalSettingsRequest, isFiscalPermissionDenied } from "./fiscal-settings-api";
import { SelectField, SuccessNotice, TextField } from "./fiscal-form-field";
const TREATMENTS = [
  { code: "GRAVADO_IVA", label: "Gravado IVA" },
  { code: "EXONERADO", label: "Exonerado" },
  { code: "EXENTO", label: "Exento" },
  { code: "GRAVADO_PARCIAL", label: "Gravado parcial" },
];
interface Classification {
  rateCode: string;
  affectation: string;
  proportionality: string | null;
}
interface List {
  items: Classification[];
  rates: { code: string; rate: string }[];
}
export function TaxClassificationSection(): JSX.Element {
  const titleId = useId();
  const [rateCode, setRateCode] = useState("");
  const [affectation, setAffectation] = useState("");
  const [proportionality, setProportionality] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["fiscal-settings", "tax-classifications"],
    retry: false,
    queryFn: () => fiscalSettingsRequest<List>("tax-classifications"),
  });
  const save = useMutation({
    mutationFn: () =>
      fiscalSettingsRequest(`tax-classifications/${encodeURIComponent(rateCode)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          affectation,
          proportionality: affectation === "GRAVADO_PARCIAL" ? proportionality : null,
        }),
      }),
    onSuccess: () => {
      setNotice("Se guardó la clasificación tributaria.");
      void query.refetch();
    },
  });
  const chooseRate = (code: string) => {
    setRateCode(code);
    setNotice(null);
    save.reset();
    const current = query.data?.items.find((item) => item.rateCode === code);
    setAffectation(current?.affectation ?? "");
    setProportionality(current?.proportionality ?? "");
  };
  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border bg-card p-5">
      <h2 id={titleId} className="text-base font-semibold">
        Clasificación tributaria
      </h2>
      <p className="text-sm text-muted-foreground">
        Declaración de la clínica para cada alícuota. No se deduce ni se carga automáticamente.
      </p>
      <SuccessNotice message={notice} />
      {query.isLoading ? (
        <ListSkeleton label="Cargando clasificaciones…" rows={1} />
      ) : query.error ? (
        isFiscalPermissionDenied(query.error) ? (
          <p>No tenés permiso para declarar el tratamiento fiscal.</p>
        ) : (
          <ErrorState
            message="No se pudieron cargar las clasificaciones."
            onRetry={() => void query.refetch()}
          />
        )
      ) : (
        <>
          <ul className="space-y-2">
            {query.data?.rates.map((rate) => {
              const current = query.data.items.find((item) => item.rateCode === rate.code);
              return (
                <li key={rate.code}>
                  {rate.code} ({rate.rate} %) ·{" "}
                  {current
                    ? TREATMENTS.find((item) => item.code === current.affectation)?.label
                    : "Sin declarar"}
                  {current?.proportionality ? ` · ${current.proportionality} %` : ""}
                </li>
              );
            })}
          </ul>
          <form
            aria-label="Declarar clasificación tributaria"
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (rateCode && affectation && !save.isPending) save.mutate();
            }}
          >
            <SelectField
              label="Alícuota"
              value={rateCode}
              onChange={chooseRate}
              emptyLabel="Seleccioná una alícuota"
              options={
                query.data?.rates.map((rate) => ({
                  code: rate.code,
                  label: `${rate.code} (${rate.rate} %)`,
                })) ?? []
              }
            />
            <SelectField
              label="Tratamiento fiscal"
              value={affectation}
              onChange={setAffectation}
              emptyLabel="Seleccioná un tratamiento"
              options={TREATMENTS}
            />
            {affectation === "GRAVADO_PARCIAL" ? (
              <TextField
                label="Proporción gravada (%)"
                value={proportionality}
                onChange={setProportionality}
              />
            ) : null}
            {save.error ? (
              <p role="alert" className="text-sm text-destructive">
                No se pudo guardar. Verificá que el tratamiento corresponda a la alícuota y la
                proporción esté entre 0 y 100, con hasta dos decimales.
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={
                !rateCode ||
                !affectation ||
                save.isPending ||
                (affectation === "GRAVADO_PARCIAL" && !proportionality)
              }
            >
              {save.isPending ? "Guardando…" : "Guardar clasificación"}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
