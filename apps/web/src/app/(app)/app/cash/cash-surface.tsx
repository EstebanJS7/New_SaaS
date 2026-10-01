"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closeSession,
  createCashRegister,
  createMovement,
  isCashNotEntitled,
  listCashRegisters,
  listCashSessions,
  listMovements,
  openCashSession,
  type CashSession,
  type CloseCashSessionInput,
  type CreateCashMovementInput,
} from "./cash-api";
import { ClosePanel } from "./close-panel";
import { MovementPanel } from "./movement-panel";
import { RegisterPanel } from "./register-panel";
import { SessionPanel, type CashSessionFilter } from "./session-panel";

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
    mutationFn: createCashRegister,
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cash", "registers"] });
    },
  });

  const openSessionMutation = useMutation({
    mutationFn: openCashSession,
    retry: false,
    onSuccess: (session) => {
      // The session the API just opened is the one the operator now operates.
      setSelectedSession(session);
      void queryClient.invalidateQueries({ queryKey: ["cash", "sessions"] });
    },
  });

  const createMovementMutation = useMutation({
    mutationFn: (input: { body: CreateCashMovementInput; idempotencyKey: string }) =>
      createMovement(input.body, input.idempotencyKey),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cash", "movements"] });
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: (input: { id: string; body: CloseCashSessionInput }) =>
      closeSession(input.id, input.body),
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

  if (readError !== null && isCashNotEntitled(readError)) {
    // UX gate only: the backend answers the same `403 FEATURE_NOT_ENTITLED` for
    // every cash call, so the workspace hides itself instead of offering actions
    // that can only fail.
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cash</h1>
          <p className="text-sm text-muted-foreground">Registers, sessions, movements and close.</p>
        </div>
        <div
          role="alert"
          data-testid="cash-entitlement-denied"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Cash features are not enabled for this tenant</p>
          <p>
            The tenant does not have the cash capability, so the workspace is not available. The API
            enforces this gate; this message is only what the browser shows.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cash</h1>
        <p className="text-sm text-muted-foreground">
          Registers, sessions, manual movements and close. The API is the authority for every
          action; the browser only reflects its outcomes.
        </p>
      </div>

      <RegisterPanel
        registers={registersQuery.data ?? []}
        isLoading={registersQuery.isLoading}
        loadError={registersQuery.error}
        onCreate={async (input) => {
          await createRegisterMutation.mutateAsync(input);
        }}
        isCreating={createRegisterMutation.isPending}
        createError={createRegisterMutation.error}
        created={createRegisterMutation.data ?? null}
      />

      <SessionPanel
        sessions={sessionsQuery.data ?? []}
        isLoading={sessionsQuery.isLoading}
        loadError={sessionsQuery.error}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        registers={registersQuery.data ?? []}
        registersLoading={registersQuery.isLoading}
        onOpen={async (input) => {
          await openSessionMutation.mutateAsync(input);
        }}
        isOpening={openSessionMutation.isPending}
        openError={openSessionMutation.error}
        opened={openSessionMutation.data ?? null}
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={setSelectedSession}
      />

      <MovementPanel
        // Remount per session: the draft, the validation and mutation errors and
        // the attempt's idempotency key all belong to ONE session, so switching
        // the selection must not carry them over (a carried key or counted
        // amount could be submitted against the wrong session).
        key={selectedSession?.id ?? "no-session"}
        session={selectedSession}
        movements={movementsQuery.data ?? []}
        isLoading={movementsQuery.isLoading}
        loadError={movementsQuery.error}
        onCreate={async (body, idempotencyKey) => {
          await createMovementMutation.mutateAsync({ body, idempotencyKey });
        }}
        isCreating={createMovementMutation.isPending}
        createError={createMovementMutation.error}
        created={createMovementMutation.data ?? null}
      />

      <ClosePanel
        key={selectedSession?.id ?? "no-session"}
        session={selectedSession}
        onClose={async (body) => {
          if (selectedSession === null) {
            return;
          }
          await closeSessionMutation.mutateAsync({ id: selectedSession.id, body });
        }}
        isClosing={closeSessionMutation.isPending}
        closeError={closeSessionMutation.error}
      />
    </div>
  );
}
