"use client";
import { ClinicalServerDrafts } from "./clinical-server-drafts";
import { ClinicalHistoryEntry } from "./clinical-history";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WeightForm } from "./weight-form";
import { ClinicalRecordRecoveryPanel } from "./clinical-record-recovery-panel";
import {
  useRecordRecovery,
  clearRecordRecovery,
  deniedClinicalRead,
  type WeightFields,
} from "./clinical-record-recovery";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { formatEsPyDecimal, formatEsPyDecimalInput, formatEsPyInstant } from "@/lib/es-py-format";
import {
  getWeight,
  searchWeights,
  userFacingWeightError,
  type WeightDetail,
} from "./weight-search-api";
import { WEIGHT_DEFAULTS, WEIGHT_LIST_CONTEXT_MS, useWeightListState } from "./weight-list-state";
import { parseWeightRange } from "./weight-filter-input";

const UNIT_MESSAGE = "Unidad no especificada en el registro.";
function WeightReader({
  patientId,
  id,
  onBack,
  onEdit,
  canReadHistory,
}: {
  patientId: string;
  id: string;
  onBack: () => void;
  canReadHistory?: boolean;
  onEdit?: (item: WeightDetail) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const query = useQuery({
    queryKey: ["clinical", patientId, "weight-detail", id],
    queryFn: ({ signal }) => getWeight(patientId, id, signal),
    staleTime: 0,
    gcTime: WEIGHT_LIST_CONTEXT_MS,
    retry: false,
  });
  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" onClick={onBack}>
        Volver al listado de pesos
      </Button>
      <h3
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Detalle del registro de peso
      </h3>
      {query.isFetching ? (
        <ListSkeleton label="Cargando registro de peso…" rows={1} />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar el registro de peso"
          message={userFacingWeightError(query.error)}
          retryLabel="Reintentar"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        query.data && (
          <div className="space-y-4">
            {onEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (query.data) onEdit(query.data);
                }}
              >
                Corregir peso
              </Button>
            )}
            <ClinicalHistoryEntry
              patientId={patientId}
              kind="weights"
              id={id}
              allowed={canReadHistory}
            />
            <dl className="space-y-3">
              <div>
                <dt className="font-medium">Valor registrado</dt>
                <dd>{formatEsPyDecimal(query.data.quantity)}</dd>
              </div>
              <div>
                <dt className="font-medium">Unidad</dt>
                <dd>{query.data.unit === "KG" ? "kg" : UNIT_MESSAGE}</dd>
              </div>
              <div>
                <dt className="font-medium">Fecha de medición</dt>
                <dd>{formatEsPyInstant(query.data.measuredAt)}</dd>
              </div>
            </dl>
          </div>
        )
      )}
    </div>
  );
}
function WeightWorkspace({
  patientId,
  permissions,
}: {
  patientId: string;
  permissions?: readonly string[];
}) {
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ initial?: WeightDetail; recovered?: WeightFields } | null>(
    null
  );
  const recovery = useRecordRecovery(patientId, "weight");
  const [notice, setNotice] = useState<string>();
  const [state, setState] = useWeightListState(patientId);
  const [min, setMin] = useState(formatEsPyDecimalInput(state.minQuantity ?? ""));
  const [max, setMax] = useState(formatEsPyDecimalInput(state.maxQuantity ?? ""));
  const [validation, setValidation] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    returnFocus = useRef(false);
  useEffect(() => {
    if (selected === null && returnFocus.current) {
      heading.current?.focus();
      returnFocus.current = false;
    }
  }, [selected, editor]);
  const query = useQuery({
    queryKey: ["clinical", patientId, "weight-search", state],
    queryFn: ({ signal }) => searchWeights(patientId, state, signal),
    enabled: selected === null && editor === null,
    staleTime: 0,
    gcTime: WEIGHT_LIST_CONTEXT_MS,
    retry: false,
  });
  const result = query.data;
  const canRecover =
    !recovery ||
    permissions === undefined ||
    permissions.includes(recovery.initial ? "vet.clinical.update" : "vet.clinical.create");
  useEffect(() => {
    if (!canRecover || deniedClinicalRead(query.error))
      clearRecordRecovery(client, patientId, "weight");
  }, [client, patientId, canRecover, query.error]);
  const count = (n: number) => n.toLocaleString("es-PY");
  if (editor !== null)
    return (
      <WeightForm
        patientId={patientId}
        initial={editor.initial}
        recovered={editor.recovered}
        onCancel={() => {
          returnFocus.current = true;
          setEditor(null);
          void client.invalidateQueries({ queryKey: ["clinical", patientId, "weight-search"] });
        }}
        onSaved={(saved) => {
          client.setQueryData(["clinical", patientId, "weight-detail", saved.id], saved);
          void client.invalidateQueries({ queryKey: ["clinical", patientId, "weight-search"] });
          void client.invalidateQueries({
            queryKey: ["clinical", patientId, "weight-detail", saved.id],
          });
          setNotice(editor.initial === undefined ? "Peso registrado." : "Peso corregido.");
          setSelected(saved.id);
          setEditor(null);
        }}
      />
    );
  if (selected !== null)
    return (
      <div className="space-y-4">
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <WeightReader
          canReadHistory={permissions?.includes("vet.clinical.history_read")}
          key={selected}
          patientId={patientId}
          id={selected}
          onBack={() => {
            returnFocus.current = true;
            setSelected(null);
          }}
          onEdit={
            !recovery && (permissions === undefined || permissions.includes("vet.clinical.update"))
              ? (initial) => {
                  setNotice(undefined);
                  setEditor({ initial });
                }
              : undefined
          }
        />
      </div>
    );
  return (
    <div className="space-y-4">
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Pesos
      </h2>
      <ClinicalServerDrafts
        patientId={patientId}
        kind="weight"
        onRecover={(copy) => {
          if (copy.kind === "weight") {
            setNotice(undefined);
            setEditor({ initial: copy.initial, recovered: copy.fields });
          }
        }}
      />
      {recovery && canRecover && query.isFetchedAfterMount && !query.isFetching && !query.error && (
        <ClinicalRecordRecoveryPanel
          key={recovery.token}
          patientId={patientId}
          entry={recovery}
          onRecover={(copy) => {
            if (copy.kind === "weight") {
              setNotice(undefined);
              setEditor({ initial: copy.initial, recovered: copy.fields });
            }
          }}
        />
      )}

      <p className="text-sm text-muted-foreground">
        Consultá los valores registrados para este paciente. Seleccioná una unidad para filtrar por
        rango.
      </p>
      {(permissions === undefined || permissions.includes("vet.clinical.create")) && (
        <Button
          type="button"
          disabled={Boolean(recovery)}
          onClick={() => {
            setNotice(undefined);
            setEditor({});
          }}
        >
          Registrar peso
        </Button>
      )}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseWeightRange(min, max);
          if (!parsed.ok) {
            setValidation(parsed.message);
            return;
          }
          if (
            (parsed.value.minQuantity !== undefined || parsed.value.maxQuantity !== undefined) &&
            (state.unit === undefined || state.unit === "all")
          ) {
            setValidation("Seleccioná kg o sin unidad para aplicar un rango de valores.");
            return;
          }
          setValidation(undefined);
          setState({ ...state, ...parsed.value, page: 1 });
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="weight-min" className="block text-sm font-medium">
              Valor mínimo
            </label>
            <Input
              id="weight-min"
              inputMode="decimal"
              value={min}
              maxLength={20}
              aria-invalid={Boolean(validation)}
              aria-describedby="weight-range-help weight-range-error"
              onChange={(e) => setMin(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="weight-max" className="block text-sm font-medium">
              Valor máximo
            </label>
            <Input
              id="weight-max"
              inputMode="decimal"
              value={max}
              maxLength={20}
              aria-invalid={Boolean(validation)}
              aria-describedby="weight-range-help weight-range-error"
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
          <Button type="submit">Aplicar filtros</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMin("");
              setMax("");
              setValidation(undefined);
              setState(WEIGHT_DEFAULTS);
            }}
          >
            Limpiar filtros
          </Button>
        </div>
        <p id="weight-range-help" className="text-sm text-muted-foreground">
          Límites opcionales, en los valores registrados. Usá coma para los decimales.
        </p>
        <p
          id="weight-range-error"
          role={validation ? "alert" : undefined}
          className="text-sm text-destructive"
        >
          {validation}
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-sm">
            <span className="block">Unidad de peso</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.unit ?? "all"}
              onChange={(e) => {
                const unit = e.target.value;
                if (unit === "all") {
                  setMin("");
                  setMax("");
                  setState({
                    ...state,
                    unit,
                    page: 1,
                    minQuantity: undefined,
                    maxQuantity: undefined,
                  });
                } else if (unit === "KG" || unit === "unspecified")
                  setState({ ...state, unit, page: 1 });
              }}
            >
              <option value="all">Todas las unidades</option>
              <option value="KG">kg</option>
              <option value="unspecified">Sin unidad especificada</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">Fecha de medición</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.period}
              onChange={(e) => {
                const period = e.target.value;
                if (period === "all" || period === "last30")
                  setState({ ...state, period, page: 1 });
              }}
            >
              <option value="all">Todas las fechas</option>
              <option value="last30">Últimos 30 días</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">Ordenar pesos</span>
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3"
              value={state.sort}
              onChange={(e) => {
                const sort = e.target.value;
                if (sort === "recent" || sort === "oldest") setState({ ...state, sort, page: 1 });
              }}
            >
              <option value="recent">Más recientes</option>
              <option value="oldest">Más antiguos</option>
            </select>
          </label>
        </div>
      </form>
      {query.isFetching ? (
        <ListSkeleton label="Buscando registros de peso…" />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar los pesos"
          message={userFacingWeightError(query.error)}
          retryLabel="Reintentar"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : result?.items.length === 0 ? (
        <EmptyState
          title="No encontramos registros de peso"
          description="Todavía no hay registros para estos filtros. Probá con otro rango o período."
        />
      ) : (
        <ul aria-label="Resultados de pesos" className="space-y-3">
          {result?.items.map((item) => (
            <li key={item.id} className="record-row">
              <div className="min-w-0">
                <p className="font-medium">
                  {formatEsPyDecimal(item.quantity)}
                  {item.unit === "KG" ? " kg" : ""}
                </p>
                {item.unit !== "KG" && (
                  <p className="text-sm text-muted-foreground">{UNIT_MESSAGE}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {formatEsPyInstant(item.measuredAt)}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setSelected(item.id)}>
                Ver registro de peso
                <span className="sr-only">
                  : {formatEsPyDecimal(item.quantity)} — {formatEsPyInstant(item.measuredAt)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!query.isFetching && !query.error && result && (
        <nav
          aria-label="Páginas de pesos"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {count(result.total)} registros
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={result.page <= 1}
              onClick={() => setState({ ...state, page: result.page - 1 })}
            >
              Anterior
            </Button>
            <span className="text-sm">
              Página {count(result.page)} de {count(Math.max(1, result.totalPages))}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={result.page >= result.totalPages || result.page >= 10000}
              onClick={() => setState({ ...state, page: result.page + 1 })}
            >
              Siguiente
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
export function WeightList({
  patientId,
  permissions,
}: {
  patientId: string;
  permissions?: readonly string[];
}) {
  return <WeightWorkspace key={patientId} patientId={patientId} permissions={permissions} />;
}
