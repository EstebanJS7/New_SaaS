"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@newsaas/ui/components/ui/button";
import { ErrorState, ListSkeleton } from "@/components/feedback";
import { formatEsPyDecimal, STAFF_LOCALE, DEFAULT_CLINIC_TIME_ZONE } from "@/lib/es-py-format";

export type HistoryKind = "treatments" | "studies" | "weights";
interface HistoryItem {
  id: string;
  actorName: string | null;
  reason: string | null;
  correctedAt: string;
  beforeVersion: number;
  afterVersion: number;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
}
interface HistoryPage {
  items: HistoryItem[];
  nextCursor: number | null;
}
const fields = {
  treatments: [
    ["description", "Descripción"],
    ["administeredAt", "Administración"],
    ["context", "Contexto"],
  ],
  studies: [
    ["studyType", "Tipo de estudio"],
    ["performedAt", "Realización"],
    ["result", "Resultado"],
  ],
  weights: [
    ["quantity", "Cantidad"],
    ["unit", "Unidad"],
    ["measuredAt", "Medición"],
  ],
} as const;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function snapshot(value: unknown, kind: HistoryKind): value is Record<string, string | null> {
  return (
    object(value) &&
    Object.keys(value).length === fields[kind].length &&
    fields[kind].every(([key]) => {
      const field = value[key];
      if (key === "unit") return field === "KG" || field === null;
      if (key === "quantity") return typeof field === "string" && /^\d+\.\d{3}$/.test(field);
      if (key.endsWith("At"))
        return typeof field === "string" && Number.isFinite(Date.parse(field));
      return typeof field === "string" || (field === null && key === "context");
    })
  );
}
class HistoryReadError extends Error {
  constructor(readonly status: number) {
    super("No pudimos leer el historial.");
  }
}
/** Existing pages may not provide role keys; resolve this specific capability on the server. */
export function ClinicalHistoryEntry({
  allowed,
  ...record
}: {
  allowed?: boolean;
  patientId: string;
  kind: HistoryKind;
  id: string;
}) {
  const access = useQuery({
    queryKey: ["clinical-history-access", record.patientId],
    enabled: allowed === undefined,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/clinical/${encodeURIComponent(record.patientId)}/history-access`,
        { cache: "no-store", signal }
      );
      if (!response.ok) throw new HistoryReadError(response.status);
      const value: unknown = await response.json();
      if (!object(value) || typeof value.allowed !== "boolean") throw new HistoryReadError(0);
      return value.allowed;
    },
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
  if (allowed === false || (allowed === undefined && access.data === false)) return null;
  if (allowed === undefined && access.error) {
    if (access.error instanceof HistoryReadError && [401, 403, 404].includes(access.error.status))
      return null;
    return (
      <ErrorState
        retryLabel="Reintentar"
        title="No pudimos comprobar el acceso al historial"
        message="Volvé a intentar para comprobar tu acceso."
        onRetry={() => {
          void access.refetch();
        }}
      />
    );
  }
  if (allowed === undefined && access.data !== true)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Comprobando acceso al historial…
      </p>
    );
  return <ClinicalHistory {...record} />;
}
export async function readClinicalHistory(
  patientId: string,
  kind: HistoryKind,
  id: string,
  beforeVersion?: number,
  signal?: AbortSignal
): Promise<HistoryPage> {
  const response = await fetch(
    `/api/clinical/${encodeURIComponent(patientId)}/${kind}/${encodeURIComponent(id)}/history/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ beforeVersion }),
      cache: "no-store",
      signal,
    }
  );
  if (!response.ok) throw new HistoryReadError(response.status);
  const data: unknown = await response.json();
  if (
    !object(data) ||
    !Array.isArray(data.items) ||
    data.items.length > 20 ||
    !(
      data.nextCursor === null ||
      (Number.isInteger(data.nextCursor) && Number(data.nextCursor) > 0)
    ) ||
    !data.items.every(
      (item: unknown) =>
        object(item) &&
        typeof item.id === "string" &&
        (typeof item.actorName === "string" || item.actorName === null) &&
        (typeof item.reason === "string" || item.reason === null) &&
        typeof item.correctedAt === "string" &&
        Number.isFinite(Date.parse(item.correctedAt)) &&
        Number.isInteger(item.beforeVersion) &&
        Number.isInteger(item.afterVersion) &&
        snapshot(item.before, kind) &&
        snapshot(item.after, kind)
    )
  )
    throw new HistoryReadError(0);
  return data as unknown as HistoryPage;
}
function display(key: string, value: string | null) {
  if (value === null) return key === "unit" ? "Unidad no especificada" : "Sin información";
  if (key.endsWith("At")) return historyInstant(value);
  if (key === "quantity") return formatEsPyDecimal(value);
  if (key === "unit") return value === "KG" ? "kg" : "Unidad no especificada";
  return value === "" ? "Sin información" : value;
}
/** History must also distinguish corrections that differ only in seconds/milliseconds. */
function historyInstant(value: string) {
  return new Intl.DateTimeFormat(STAFF_LOCALE, {
    timeZone: DEFAULT_CLINIC_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(new Date(value));
}

/** Veterinary-only, same-document history. No restoration, storage or URL state. */
export function ClinicalHistory({
  patientId,
  kind,
  id,
}: {
  patientId: string;
  kind: HistoryKind;
  id: string;
}) {
  const [open, setOpen] = useState(false),
    [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const heading = useRef<HTMLHeadingElement>(null),
    button = useRef<HTMLButtonElement>(null),
    label = useId();
  const cursor = cursors.at(-1);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open, cursor]);
  const query = useQuery({
    queryKey: ["clinical-history", patientId, kind, id, cursor],
    queryFn: ({ signal }) => readClinicalHistory(patientId, kind, id, cursor, signal),
    enabled: open,
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
  return (
    <div className="space-y-3">
      <Button
        ref={button}
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={label}
        onClick={() => {
          setOpen(!open);
          if (open) button.current?.focus();
        }}
      >
        {" "}
        {open ? "Ocultar historial" : "Ver historial"}
      </Button>
      {open && (
        <section
          id={label}
          aria-label="Historial de correcciones"
          className="space-y-4 rounded-lg border border-border p-4"
        >
          <h4
            ref={heading}
            tabIndex={-1}
            className="font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Historial de correcciones
          </h4>
          <p className="text-sm text-muted-foreground">
            Mostramos las correcciones conservadas desde la activación del historial. No
            reconstruimos cambios anteriores.
          </p>
          {query.isFetching ? (
            <ListSkeleton label="Cargando historial…" rows={1} />
          ) : query.error ? (
            <ErrorState
              retryLabel="Reintentar"
              title="No pudimos cargar el historial"
              message={
                query.error instanceof HistoryReadError && query.error.status === 403
                  ? "No tenés permiso para consultar el historial."
                  : "Volvé a intentar para consultar las correcciones conservadas."
              }
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : (
            query.data && (
              <>
                {query.data.items.length === 0 && (
                  <p>No hay correcciones conservadas para este registro.</p>
                )}
                {query.data.items.map((item) => (
                  <article key={item.id} className="space-y-3 border-t border-border pt-3">
                    <p className="font-medium">Corrección del {historyInstant(item.correctedAt)}</p>
                    <p className="break-words text-sm">
                      Realizada por: {item.actorName ?? "Actor no informado"}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      Motivo: {item.reason ?? "Sin motivo informado"}
                    </p>
                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                      {(["before", "after"] as const).map((side) => (
                        <div key={side} className="min-w-0 space-y-2">
                          <h5 className="font-medium">{side === "before" ? "Antes" : "Después"}</h5>
                          <dl className="space-y-2 text-sm">
                            {fields[kind].map(([key, title]) => (
                              <div key={key}>
                                <dt className="font-medium">{title}</dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {display(key, item[side][key])}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                <nav aria-label="Páginas del historial" className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={cursors.length === 1}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                  >
                    Más recientes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={query.data.nextCursor === null}
                    onClick={() => {
                      if (query.data?.nextCursor) setCursors([...cursors, query.data.nextCursor]);
                    }}
                  >
                    Más antiguas
                  </Button>
                </nav>
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
