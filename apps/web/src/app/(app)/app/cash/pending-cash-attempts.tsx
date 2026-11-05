"use client";

import type { JSX } from "react";
import { useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { forgetAttempt, pendingAttempts, type PendingAttempt } from "@/lib/pending-attempts";
import { getMovementAttempt, getSessionAttempt, type CashSession } from "./cash-api";

type Outcome = "unknown" | "checking" | "recorded" | "absent" | "failed";

/**
 * UX-035 / TD-073 — cash openings and movements a previous page never got an
 * answer for (reload, Back/Forward, crash).
 *
 * The tab's pending-attempt memory keeps only each attempt's KEY; this panel asks
 * the API what that key recorded. A recorded opening can be selected; a recorded
 * movement is already in the ledger; an absent one recorded nothing and is
 * forgotten. It never re-sends: the amount and reason were never stored.
 */
export function PendingCashAttempts({
  onSessionFound,
}: {
  readonly onSessionFound: (session: CashSession) => void;
}): JSX.Element | null {
  const [attempts] = useState<PendingAttempt[]>(() => [
    ...pendingAttempts("cash.session.open"),
    ...pendingAttempts("cash.movement.create"),
  ]);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const visible = attempts.filter((attempt) => outcomes[attempt.key] !== "absent");
  if (visible.length === 0) return null;

  async function check(attempt: PendingAttempt): Promise<void> {
    setOutcomes((previous) => ({ ...previous, [attempt.key]: "checking" }));
    try {
      if (attempt.kind === "cash.session.open") {
        const session = await getSessionAttempt(attempt.key);
        forgetAttempt(attempt.key);
        setOutcomes((previous) => ({
          ...previous,
          [attempt.key]: session ? "recorded" : "absent",
        }));
        if (session) onSessionFound(session);
      } else {
        const movement = await getMovementAttempt(attempt.key);
        forgetAttempt(attempt.key);
        setOutcomes((previous) => ({
          ...previous,
          [attempt.key]: movement ? "recorded" : "absent",
        }));
      }
    } catch {
      setOutcomes((previous) => ({ ...previous, [attempt.key]: "failed" }));
    }
  }

  return (
    <section
      aria-label="Operaciones de Caja de un intento anterior"
      data-testid="pending-cash-attempts"
      className="space-y-3 rounded-lg border border-border bg-secondary p-4 text-sm"
    >
      <p className="font-medium">Hay operaciones de Caja de un intento anterior sin confirmar</p>
      <p className="text-muted-foreground">
        La página se recargó o se cerró antes de recibir la respuesta. Consultá cada una antes de
        repetirla: el sistema la busca por su clave, sin reenviarla.
      </p>
      <ul className="space-y-2">
        {visible.map((attempt) => {
          const outcome = outcomes[attempt.key] ?? "unknown";
          const label = attempt.kind === "cash.session.open" ? "Apertura de sesión" : "Movimiento";
          const time = new Date(attempt.startedAt).toLocaleTimeString("es-PY", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <li key={attempt.key} className="flex flex-wrap items-center gap-3">
              <span>{`${label} de las ${time}`}</span>
              {outcome === "recorded" ? (
                <span className="font-medium">
                  {attempt.kind === "cash.session.open"
                    ? "Se abrió: la sesión quedó seleccionada."
                    : "Se registró: ya figura en los movimientos de la sesión."}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void check(attempt)}
                  disabled={outcome === "checking"}
                >
                  {outcome === "checking" ? "Consultando…" : "Consultar"}
                </Button>
              )}
              {outcome === "failed" && <span>No se pudo consultar; reintentá.</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
