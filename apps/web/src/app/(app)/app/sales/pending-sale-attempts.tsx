"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";
import { forgetAttempt, pendingAttempts, type PendingAttempt } from "@/lib/pending-attempts";
import { getSaleCreateAttempt, type Sale } from "./sales-api";

type Outcome =
  | { readonly state: "unknown" }
  | { readonly state: "checking" }
  | { readonly state: "created"; readonly sale: Sale }
  | { readonly state: "absent" }
  | { readonly state: "failed" };

/**
 * UX-035 / TD-071 — sale creations a previous page never got an answer for.
 *
 * A reload, Back/Forward or a crash loses the counter's in-page copy. The tab's
 * pending-attempt memory still holds the KEY (and nothing else), so this panel
 * offers to ask the API what that attempt recorded: the draft, which the person
 * opens and continues, or nothing, which is then forgotten. It never re-sends.
 */
export function PendingSaleAttempts({
  excludeKey,
}: {
  readonly excludeKey?: string;
}): JSX.Element | null {
  const [attempts] = useState<PendingAttempt[]>(() =>
    pendingAttempts("sale.create").filter((attempt) => attempt.key !== excludeKey)
  );
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const visible = attempts.filter((attempt) => outcomes[attempt.key]?.state !== "absent");
  if (visible.length === 0) return null;

  async function check(key: string): Promise<void> {
    setOutcomes((previous) => ({ ...previous, [key]: { state: "checking" } }));
    try {
      const sale = await getSaleCreateAttempt(key);
      forgetAttempt(key);
      setOutcomes((previous) => ({
        ...previous,
        [key]: sale === null ? { state: "absent" } : { state: "created", sale },
      }));
    } catch {
      setOutcomes((previous) => ({ ...previous, [key]: { state: "failed" } }));
    }
  }

  return (
    <div
      role="status"
      data-testid="pending-sale-attempts"
      className="space-y-3 rounded-lg border border-border bg-secondary p-4 text-sm"
    >
      <p className="font-medium">Hay ventas de un intento anterior sin confirmar</p>
      <p className="text-muted-foreground">
        La página se recargó o se cerró antes de recibir la respuesta. Consultá cada intento antes
        de volver a cargar la venta: el sistema lo busca por su clave, sin reenviarlo.
      </p>
      <ul className="space-y-2">
        {visible.map((attempt) => {
          const outcome = outcomes[attempt.key] ?? { state: "unknown" };
          return (
            <li key={attempt.key} className="flex flex-wrap items-center gap-3">
              <span>{`Intento de las ${new Date(attempt.startedAt).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}`}</span>
              {outcome.state === "created" ? (
                <Link
                  href={`/app/sales/${outcome.sale.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  Se creó: abrir la venta
                </Link>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void check(attempt.key)}
                  disabled={outcome.state === "checking"}
                >
                  {outcome.state === "checking" ? "Consultando…" : "Consultar"}
                </Button>
              )}
              {outcome.state === "failed" && <span>No se pudo consultar; reintentá.</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
