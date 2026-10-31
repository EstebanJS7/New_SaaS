"use client";
import { ClinicalServerDrafts } from "./clinical-server-drafts";
import { ClinicalHistoryEntry } from "./clinical-history";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StudyForm } from "./study-form";
import { ClinicalRecordRecoveryPanel } from "./clinical-record-recovery-panel";
import {
  useRecordRecovery,
  clearRecordRecovery,
  deniedClinicalRead,
  type StudyFields,
} from "./clinical-record-recovery";
import { Button } from "@newsaas/ui/components/ui/button";
import { Input } from "@newsaas/ui/components/ui/input";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/feedback";
import { formatEsPyInstant } from "@/lib/es-py-format";
import {
  getStudy,
  searchStudies,
  userFacingStudyError,
  type StudyDetail,
} from "./study-search-api";
import { STUDY_DEFAULTS, STUDY_LIST_CONTEXT_MS, useStudyListState } from "./study-list-state";

function StudyReader({
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
  onEdit?: (item: StudyDetail) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const query = useQuery({
    queryKey: ["clinical", patientId, "study-detail", id],
    queryFn: ({ signal }) => getStudy(patientId, id, signal),
    staleTime: 0,
    gcTime: STUDY_LIST_CONTEXT_MS,
    retry: false,
  });
  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" onClick={onBack}>
        Volver al listado de estudios
      </Button>
      <h3
        ref={heading}
        tabIndex={-1}
        className="text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Detalle del estudio
      </h3>
      {query.isFetching ? (
        <ListSkeleton label="Cargando estudio…" rows={1} />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar el estudio"
          message={userFacingStudyError(query.error)}
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
                Corregir estudio
              </Button>
            )}
            <ClinicalHistoryEntry
              patientId={patientId}
              kind="studies"
              id={id}
              allowed={canReadHistory}
            />
            <dl className="space-y-3">
              <div>
                <dt className="font-medium">Fecha de realización</dt>
                <dd>{formatEsPyInstant(query.data.performedAt)}</dd>
              </div>
              <div>
                <dt className="font-medium">Tipo de estudio</dt>
                <dd className="whitespace-pre-wrap break-words">{query.data.studyType}</dd>
              </div>
              <div>
                <dt className="font-medium">Resultado</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {query.data.result.trim().length === 0
                    ? "Sin resultado registrado."
                    : query.data.result}
                </dd>
              </div>
            </dl>
          </div>
        )
      )}
    </div>
  );
}

function StudyWorkspace({
  patientId,
  permissions,
}: {
  patientId: string;
  permissions?: readonly string[];
}) {
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ initial?: StudyDetail; recovered?: StudyFields } | null>(
    null
  );
  const recovery = useRecordRecovery(patientId, "study");
  const [notice, setNotice] = useState<string>();
  const [state, setState] = useStudyListState(patientId);
  const [search, setSearch] = useState(state.q);
  const [validation, setValidation] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (selected === null && returnFocus.current) {
      heading.current?.focus();
      returnFocus.current = false;
    }
  }, [selected, editor]);
  const query = useQuery({
    queryKey: ["clinical", patientId, "study-search", state],
    queryFn: ({ signal }) => searchStudies(patientId, state, signal),
    enabled: selected === null && editor === null,
    staleTime: 0,
    gcTime: STUDY_LIST_CONTEXT_MS,
    retry: false,
  });
  const result = query.data;
  const canRecover =
    !recovery ||
    permissions === undefined ||
    permissions.includes(recovery.initial ? "vet.clinical.update" : "vet.clinical.create");
  useEffect(() => {
    if (!canRecover || deniedClinicalRead(query.error))
      clearRecordRecovery(client, patientId, "study");
  }, [client, patientId, canRecover, query.error]);
  const count = (n: number) => n.toLocaleString("es-PY");
  if (editor !== null)
    return (
      <StudyForm
        patientId={patientId}
        initial={editor.initial}
        recovered={editor.recovered}
        onCancel={() => {
          returnFocus.current = true;
          setEditor(null);
          void client.invalidateQueries({ queryKey: ["clinical", patientId, "study-search"] });
        }}
        onSaved={(saved) => {
          client.setQueryData(["clinical", patientId, "study-detail", saved.id], saved);
          void client.invalidateQueries({ queryKey: ["clinical", patientId, "study-search"] });
          void client.invalidateQueries({
            queryKey: ["clinical", patientId, "study-detail", saved.id],
          });
          setNotice(editor.initial === undefined ? "Estudio registrado." : "Estudio corregido.");
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
        <StudyReader
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
        Estudios
      </h2>
      <ClinicalServerDrafts
        patientId={patientId}
        kind="study"
        onRecover={(copy) => {
          if (copy.kind === "study") {
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
            if (copy.kind === "study") {
              setNotice(undefined);
              setEditor({ initial: copy.initial, recovered: copy.fields });
            }
          }}
        />
      )}

      <p className="text-sm text-muted-foreground">
        Consultá los estudios registrados para este paciente.
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
          Registrar estudio
        </Button>
      )}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const q = search.trim();
          if ((q.length > 0 && q.length < 2) || q.length > 80) {
            setValidation("Ingresá entre 2 y 80 caracteres o dejá la búsqueda vacía.");
            return;
          }
          setValidation(undefined);
          setState({ ...state, q, page: 1 });
        }}
      >
        <label htmlFor="study-search" className="block text-sm font-medium">
          Buscar por tipo de estudio
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="study-search"
            className="min-w-0 flex-1"
            value={search}
            maxLength={80}
            aria-invalid={Boolean(validation)}
            aria-describedby={validation ? "study-search-error" : undefined}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit">Buscar</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch("");
              setValidation(undefined);
              setState(STUDY_DEFAULTS);
            }}
          >
            Limpiar filtros
          </Button>
        </div>
        {validation && (
          <p id="study-search-error" role="alert" className="text-sm text-destructive">
            {validation}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-sm">
            <span className="block">Fecha de realización</span>
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
            <span className="block">Ordenar estudios</span>
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
        <ListSkeleton label="Buscando estudios…" />
      ) : query.error ? (
        <ErrorState
          title="No pudimos cargar los estudios"
          message={userFacingStudyError(query.error)}
          retryLabel="Reintentar"
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : result?.items.length === 0 ? (
        <EmptyState
          title="No encontramos estudios"
          description="Todavía no hay registros para esta búsqueda. Probá con otro tipo de estudio o cambiá los filtros."
        />
      ) : (
        <ul aria-label="Resultados de estudios" className="space-y-3">
          {result?.items.map((item) => (
            <li key={item.id} className="record-row">
              <div className="min-w-0">
                <p className="line-clamp-2 whitespace-pre-wrap break-words">{item.studyType}</p>
                <p className="text-sm text-muted-foreground">
                  {formatEsPyInstant(item.performedAt)}
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => setSelected(item.id)}>
                Ver estudio<span className="sr-only">: {item.studyType.slice(0, 80)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!query.isFetching && !query.error && result && (
        <nav
          aria-label="Páginas de estudios"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {count(result.total)} estudios
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

/** Keying prevents patient result and in-flight results from leaking across navigation. */
export function StudyList({
  patientId,
  permissions,
}: {
  patientId: string;
  permissions?: readonly string[];
}) {
  return <StudyWorkspace key={patientId} patientId={patientId} permissions={permissions} />;
}
