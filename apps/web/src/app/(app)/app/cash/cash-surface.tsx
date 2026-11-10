"use client";

import type { JSX } from "react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closeSession,
  ApiRequestError,
  createCashRegister,
  createMovement,
  getSessionAttempt,
  isCashNotEntitled,
  listCashRegisters,
  listCashSessions,
  listMovements,
  openCashSession,
  type CashSession,
  type CloseCashSessionInput,
  type CreateCashMovementInput,
  type OpenCashSessionInput,
} from "./cash-api";
import { useCan } from "@/lib/capabilities";
import { CASH_ACTIONS } from "./cash-capabilities";
import { ClosePanel } from "./close-panel";
import { MovementPanel } from "./movement-panel";
import { RegisterPanel } from "./register-panel";
import { SessionPanel, type CashSessionFilter } from "./session-panel";
import { Button } from "@newsaas/ui/components/ui/button";
import { forgetAttempt, newAttemptKey, rememberAttempt } from "@/lib/pending-attempts";
import { PendingCashAttempts } from "./pending-cash-attempts";
import { useCashAttemptExit } from "./cash-attempt-exit";
import { DEFAULT_CLINIC_TIME_ZONE } from "@/lib/es-py-format";
import { useWorkingBranches } from "@/lib/working-branches";

type CashCommandKind = "register" | "open" | "movement" | "close";
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function uncertainFailure(error: unknown): boolean {
  return !(
    error instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(error.status)
  );
}
function sessionReceipt(value: CashSession | null | undefined): value is CashSession {
  return (
    !!value &&
    uuid(value.id) &&
    uuid(value.registerId) &&
    ["OPEN", "CLOSED"].includes(value.status) &&
    typeof value.openingAmount === "string" &&
    typeof value.openedAt === "string" &&
    [value.expectedAmount, value.countedAmount, value.differenceAmount].every(
      (amount) => amount === null || typeof amount === "string"
    )
  );
}

/**
 * The staff Cash workspace (EPIC-13 CASH-004, DEC-037).
 *
 * Composition: one surface owns the reads and the four explicit commands, and
 * the panels below it are presentational. Every call goes through the Cash
 * client in this directory, which talks to the authenticated web proxy — the
 * browser never sends a tenant id, and no check here is an authorization
 * authority. The surface reflects the API's outcomes; it never invents one.
 *
 * The surface's shape follows DEC-037 and the API's own surface: registers,
 * sessions (with the API's `status` filter), the selected session's immutable
 * movements and the terminal close. There is no reopen, no delete and no
 * reversal anywhere, and the `SALE` movement kind is not offered because only
 * sale completion writes one (DEC-020/033).
 *
 * The only UX gate is the `cash` capability: a `403 FEATURE_NOT_ENTITLED` from
 * any read hides the workspace instead of offering actions that can only fail.
 * A `403 FORBIDDEN` is rendered in place of the data it refused — it is not a
 * capability problem and the backend remains the authority either way.
 */
export function CashSurface(): JSX.Element {
  const cashEnabled = useCan(CASH_ACTIONS.enabled);
  const canCreateRegister = useCan(CASH_ACTIONS.createRegister);
  const canOpenSession = useCan(CASH_ACTIONS.openSession);
  const canCreateMovement = useCan(CASH_ACTIONS.createMovement);
  const canCloseSession = useCan(CASH_ACTIONS.closeSession);
  // MB-002: where the person works, for the new-drawer form.
  const workingBranches = useWorkingBranches();
  const gate = useRef(false);
  const [commandPending, setCommandPending] = useState(false);
  const uncertainRef = useRef<CashCommandKind | null>(null);
  const [uncertain, setUncertain] = useState<CashCommandKind | null>(null);
  const movementAttempt = useRef<{ body: CreateCashMovementInput; key: string } | null>(null);
  const closeTarget = useRef<string | null>(null);
  // UX-035 / TD-073: the open attempt and its key, kept for lookup and retry.
  const openAttempt = useRef<{ input: OpenCashSessionInput; key: string } | null>(null);
  const [openAbsent, setOpenAbsent] = useState(false);
  const [movementRevision, setMovementRevision] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  function markUncertain(kind: CashCommandKind | null): void {
    uncertainRef.current = kind;
    setUncertain(kind);
  }
  async function execute<T>(
    kind: CashCommandKind,
    send: () => Promise<T>,
    recovery = false
  ): Promise<T> {
    if (
      gate.current ||
      (uncertainRef.current !== null && (!recovery || uncertainRef.current !== kind))
    )
      throw new Error("Cash attempt requires resolution.");
    gate.current = true;
    setCommandPending(true);
    try {
      const result = await send();
      markUncertain(null);
      return result;
    } catch (error) {
      if (recovery || uncertainFailure(error)) markUncertain(kind);
      throw error;
    } finally {
      gate.current = false;
      setCommandPending(false);
    }
  }
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<CashSessionFilter>("ALL");
  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null);

  const registersQuery = useQuery({
    queryKey: ["cash", "registers"],
    queryFn: listCashRegisters,
    retry: false,
  });

  const sessionsQuery = useQuery({
    queryKey: ["cash", "sessions", statusFilter],
    queryFn: () => listCashSessions(statusFilter === "ALL" ? {} : { status: statusFilter }),
    retry: false,
  });

  const movementsQuery = useQuery({
    queryKey: ["cash", "movements", selectedSession?.id ?? "none"],
    queryFn: () =>
      selectedSession === null
        ? Promise.resolve([])
        : listMovements({ sessionId: selectedSession.id }),
    retry: false,
    enabled: selectedSession !== null,
  });

  const createRegisterMutation = useMutation({
    mutationFn: async (input: Parameters<typeof createCashRegister>[0]) => {
      const row = await createCashRegister(input);
      if (!row || !uuid(row.id) || typeof row.name !== "string")
        throw new Error("Unconfirmed register receipt");
      return row;
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cash", "registers"] });
    },
  });

  const openSessionMutation = useMutation({
    mutationFn: async (attempt: { input: OpenCashSessionInput; key: string }) => {
      const input = attempt.input;
      const row = await openCashSession(input, { idempotencyKey: attempt.key });
      if (!sessionReceipt(row) || row.registerId !== input.registerId || row.status !== "OPEN")
        throw new Error("Unconfirmed opening receipt");
      return row;
    },
    retry: false,
    onSuccess: (session, attempt) => {
      forgetAttempt(attempt.key);
      // The session the API just opened is the one the operator now operates.
      setSelectedSession(session);
      void queryClient.invalidateQueries({ queryKey: ["cash", "sessions"] });
    },
  });

  const createMovementMutation = useMutation({
    mutationFn: async (input: { body: CreateCashMovementInput; idempotencyKey: string }) => {
      const row = await createMovement(input.body, input.idempotencyKey);
      if (
        !row ||
        !uuid(row.id) ||
        row.sessionId !== input.body.sessionId ||
        typeof row.amount !== "string"
      )
        throw new Error("Unconfirmed movement receipt");
      return row;
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cash", "movements"] });
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: async (input: { id: string; body: CloseCashSessionInput }) => {
      const row = await closeSession(input.id, input.body);
      if (!sessionReceipt(row) || row.id !== input.id || row.status !== "CLOSED")
        throw new Error("Unconfirmed close receipt");
      return row;
    },
    retry: false,
    onSuccess: (session) => {
      // Show what the close returned: the closed session carries the expected,
      // counted and difference amounts the command computed.
      setSelectedSession(session);
      void queryClient.invalidateQueries({ queryKey: ["cash", "sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["cash", "movements"] });
    },
  });

  const readError = registersQuery.error ?? sessionsQuery.error ?? movementsQuery.error;
  const pending =
    commandPending ||
    recovering ||
    createRegisterMutation.isPending ||
    openSessionMutation.isPending ||
    createMovementMutation.isPending ||
    closeSessionMutation.isPending;
  const blocked = pending || uncertain !== null;
  const exitDialog = useCashAttemptExit(pending, uncertain !== null);
  async function replayMovement(): Promise<void> {
    const attempt = movementAttempt.current;
    if (!attempt || gate.current || uncertainRef.current !== "movement") return;
    setRecovering(true);
    try {
      await execute(
        "movement",
        () =>
          createMovementMutation.mutateAsync({ body: attempt.body, idempotencyKey: attempt.key }),
        true
      );
      forgetAttempt(attempt.key);
      movementAttempt.current = null;
      setMovementRevision((value) => value + 1);
    } catch {
      /* Preserve the same frozen attempt and safe mutation error. */
    } finally {
      setRecovering(false);
    }
  }
  /**
   * UX-035 / TD-073: asks the API, by the attempt's key, whether the open was
   * recorded. Found: the session is selected as if the answer had arrived.
   * Absent: nothing was recorded and the same-key retry below is safe.
   */
  async function readOpenState(): Promise<void> {
    const attempt = openAttempt.current;
    if (!attempt || gate.current || uncertainRef.current !== "open") return;
    gate.current = true;
    setRecovering(true);
    setRecoveryError(false);
    try {
      const row = await getSessionAttempt(attempt.key);
      if (row === null) {
        setOpenAbsent(true);
        return;
      }
      if (!sessionReceipt(row)) throw new Error("Unconfirmed session state");
      forgetAttempt(attempt.key);
      setSelectedSession(row);
      openSessionMutation.reset();
      openAttempt.current = null;
      setOpenAbsent(false);
      markUncertain(null);
      void queryClient.invalidateQueries({ queryKey: ["cash", "sessions"] });
    } catch {
      setRecoveryError(true);
    } finally {
      gate.current = false;
      setRecovering(false);
    }
  }
  async function retryOpen(): Promise<void> {
    const attempt = openAttempt.current;
    if (!attempt || gate.current || uncertainRef.current !== "open") return;
    setRecovering(true);
    setOpenAbsent(false);
    try {
      await execute("open", () => openSessionMutation.mutateAsync(attempt), true);
      openAttempt.current = null;
    } catch {
      /* The same attempt and key stay for another lookup or retry. */
    } finally {
      setRecovering(false);
    }
  }
  async function readCloseState(): Promise<void> {
    const id = closeTarget.current;
    if (!id || gate.current || uncertainRef.current !== "close") return;
    gate.current = true;
    setRecovering(true);
    setRecoveryError(false);
    try {
      const rows = await listCashSessions();
      const row = rows.find((item) => item.id === id);
      if (!sessionReceipt(row)) throw new Error("Unconfirmed session state");
      setSelectedSession(row);
      closeSessionMutation.reset();
      markUncertain(null);
    } catch {
      setRecoveryError(true);
    } finally {
      gate.current = false;
      setRecovering(false);
    }
  }

  if (!cashEnabled || (readError !== null && isCashNotEntitled(readError))) {
    // UX gate only: the backend answers the same `403 FEATURE_NOT_ENTITLED` for
    // every cash call, so the workspace hides itself instead of offering actions
    // that can only fail.
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {exitDialog}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
          <p className="text-sm text-muted-foreground">Cajas, sesiones, movimientos y cierre.</p>
        </div>
        <div
          role="alert"
          data-testid="cash-entitlement-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Caja no está habilitada para esta organización</p>
          <p>Esta organización no tiene habilitada la función de Caja.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {exitDialog}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
        <p className="text-sm text-muted-foreground">
          Gestioná las cajas, sus sesiones y los movimientos de efectivo. Los resultados se muestran
          después de la confirmación del servidor.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">Fechas y horas en {DEFAULT_CLINIC_TIME_ZONE}.</p>
      <PendingCashAttempts
        onSessionFound={(session) => {
          if (!gate.current && uncertainRef.current === null) setSelectedSession(session);
          void queryClient.invalidateQueries({ queryKey: ["cash"] });
        }}
      />
      {uncertain !== null && (
        <section
          aria-label="Intento de Caja sin confirmar"
          className="space-y-3 rounded-lg border border-border bg-secondary p-4 text-sm"
        >
          <p role="alert">
            No confirmamos el resultado de la operación enviada. Los comandos y el cambio de sesión
            están bloqueados para conservar ese intento.
          </p>
          {uncertain === "movement" && (
            <Button type="button" disabled={pending} onClick={() => void replayMovement()}>
              Reintentar el mismo movimiento
            </Button>
          )}
          {uncertain === "close" && (
            <Button type="button" disabled={pending} onClick={() => void readCloseState()}>
              Consultar estado de la sesión
            </Button>
          )}
          {uncertain === "open" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={() => void readOpenState()}>
                  Consultar si se abrió
                </Button>
                {openAbsent && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void retryOpen()}
                  >
                    Reintentar la misma apertura
                  </Button>
                )}
              </div>
              {openAbsent && (
                <p data-testid="open-attempt-absent">
                  El servidor no registró esa apertura. El reintento usa la misma clave, así que no
                  puede abrir dos sesiones.
                </p>
              )}
            </div>
          )}
          {uncertain === "register" && (
            <p>
              No recibimos un identificador confirmado. No vuelvas a enviar la creación; revisá su
              resultado antes de iniciar otra operación.
            </p>
          )}
          {recoveryError && (
            <p role="alert">
              No pudimos verificar la sesión. Conservamos el bloqueo; podés volver a consultar su
              estado.
            </p>
          )}
          <p>Salir pierde la copia local y no cancela ni confirma la operación.</p>
        </section>
      )}

      <RegisterPanel
        commandsBlocked={blocked}
        registers={registersQuery.data ?? []}
        isLoading={registersQuery.isLoading}
        loadError={registersQuery.error}
        onCreate={async (input) => {
          await execute("register", () => createRegisterMutation.mutateAsync(input));
        }}
        isCreating={createRegisterMutation.isPending}
        createError={createRegisterMutation.error}
        created={createRegisterMutation.data ?? null}
        branches={workingBranches.branches}
        canCreate={canCreateRegister}
      />

      <SessionPanel
        commandsBlocked={blocked}
        sessions={sessionsQuery.data ?? []}
        isLoading={sessionsQuery.isLoading}
        loadError={sessionsQuery.error}
        statusFilter={statusFilter}
        onStatusFilterChange={(value) => {
          if (!gate.current && uncertainRef.current === null) setStatusFilter(value);
        }}
        registers={registersQuery.data ?? []}
        registersLoading={registersQuery.isLoading}
        onOpen={async (input) => {
          const attempt = { input: Object.freeze({ ...input }), key: newAttemptKey() };
          openAttempt.current = attempt;
          setOpenAbsent(false);
          rememberAttempt("cash.session.open", attempt.key);
          try {
            await execute("open", () => openSessionMutation.mutateAsync(attempt));
            openAttempt.current = null;
          } catch (error) {
            if (!uncertainFailure(error)) {
              forgetAttempt(attempt.key);
              openAttempt.current = null;
            }
            throw error;
          }
        }}
        canOpenSession={canOpenSession}
        isOpening={openSessionMutation.isPending}
        openError={openSessionMutation.error}
        opened={openSessionMutation.data ?? null}
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={(value) => {
          if (!gate.current && uncertainRef.current === null) {
            setSelectedSession(value);
            createMovementMutation.reset();
            closeSessionMutation.reset();
            movementAttempt.current = null;
            closeTarget.current = null;
          }
        }}
      />

      <MovementPanel
        // Remount per session: the draft, the validation and mutation errors and
        // the attempt's idempotency key all belong to ONE session, so switching
        // the selection must not carry them over (a carried key or counted
        // amount could be submitted against the wrong session).
        key={`movements-${selectedSession?.id ?? "no-session"}-${movementRevision}`}
        commandsBlocked={blocked}
        session={selectedSession}
        movements={movementsQuery.data ?? []}
        isLoading={movementsQuery.isLoading}
        loadError={movementsQuery.error}
        onCreate={async (body, idempotencyKey) => {
          rememberAttempt("cash.movement.create", idempotencyKey);
          try {
            await execute("movement", async () => {
              movementAttempt.current = { body: Object.freeze({ ...body }), key: idempotencyKey };
              return createMovementMutation.mutateAsync({ body, idempotencyKey });
            });
          } catch (error) {
            if (!uncertainFailure(error)) forgetAttempt(idempotencyKey);
            throw error;
          }
          forgetAttempt(idempotencyKey);
          movementAttempt.current = null;
        }}
        canCreate={canCreateMovement}
        isCreating={createMovementMutation.isPending}
        createError={createMovementMutation.error}
        created={createMovementMutation.data ?? null}
      />

      <ClosePanel
        commandsBlocked={blocked}
        key={`close-${selectedSession?.id ?? "no-session"}`}
        session={selectedSession}
        onClose={async (body) => {
          if (selectedSession === null) {
            return;
          }
          const id = selectedSession.id;
          await execute("close", async () => {
            closeTarget.current = id;
            return closeSessionMutation.mutateAsync({ id, body });
          });
        }}
        canClose={canCloseSession}
        isClosing={closeSessionMutation.isPending}
        closeError={closeSessionMutation.error}
      />
    </div>
  );
}
