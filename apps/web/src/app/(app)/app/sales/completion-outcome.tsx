"use client";

import type { JSX } from "react";
import type { SaleCompletionFailure } from "./sales-api";

/**
 * The completion outcome mapping (EPIC-12 POS-004, POS-003 contract).
 *
 * The API answers a completion in exactly the ways POS-003 defined, and the
 * counter must render each one honestly instead of collapsing them into a single
 * failure. This module turns the classifier E1 shipped
 * (`classifySaleCompletionError`) and the completion response's replay
 * discriminant into stable, value-free UX copy.
 *
 * The copy is UX only: the backend already decided the outcome. Two invariants
 * are stated by the copy itself: a success is only ever rendered from the API's
 * returned completed sale (there is no locally assumed completion), and a
 * refusal never claims the sale completed.
 */

/** The heading and body a single outcome renders. */
export interface CompletionOutcomeCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The copy for a completed sale. A fresh `201` and an identical `200` replay
 * carry the SAME body, so the `replayed` discriminant from the API — and never a
 * local assumption — is what tells "just completed" apart from "already
 * completed".
 */
export function completedOutcomeCopy(replayed: boolean): CompletionOutcomeCopy {
  return replayed
    ? {
        title: "La venta ya estaba completada",
        description:
          "El sistema reconoció una repetición idéntica y devolvió la venta completada. No se volvió a completar ni se duplicaron los movimientos de stock o caja.",
      }
    : {
        title: "Venta completada",
        description:
          "El sistema confirmó la venta. Sus movimientos de stock y caja quedaron registrados.",
      };
}

/**
 * The copy for a failed completion, per stable outcome. Every branch states what
 * actually happened; the ones where a refusal persists nothing say so, and the
 * transport branch says the outcome is unknown rather than guessing.
 */
export function completionFailureCopy(failure: SaleCompletionFailure): CompletionOutcomeCopy {
  switch (failure) {
    case "permission-denied":
      return {
        title: "Sin permiso",
        description: "No tenés permiso para completar ventas. La venta no se completó.",
      };
    case "not-entitled":
      return {
        title: "Ventas no habilitadas",
        description:
          "Esta organización no tiene habilitada la función de ventas. La venta no se completó.",
      };
    case "not-found":
      return {
        title: "No encontramos la venta",
        description: "La venta no existe en esta organización. No se completó ninguna operación.",
      };
    case "not-editable":
      return {
        title: "La venta ya no es un borrador",
        description:
          "El estado de la venta cambió y no se aplicó esta operación. Consultá su estado actual antes de continuar.",
      };
    case "payment-total-mismatch":
      return {
        title: "Los pagos no coinciden con el total",
        description:
          "El sistema rechazó los pagos y no guardó la operación. Ajustá los importes para que coincidan exactamente con el total.",
      };
    case "missing-cash-session":
      return {
        title: "Se necesita una sesión de caja abierta",
        description:
          "No hay una sesión de caja abierta para el pago en efectivo. Abrí una sesión antes de volver a intentar.",
      };
    case "ambiguous-cash-session":
      return {
        title: "Hay más de una sesión de caja abierta",
        description:
          "El pago en efectivo no puede asociarse a una sola caja. Cerrá las sesiones adicionales antes de volver a intentar.",
      };
    case "insufficient-stock":
      return {
        title: "Stock insuficiente",
        description:
          "La política de stock rechazó la operación. La venta no se completó y el stock no cambió.",
      };
    case "inactive-item":
      return {
        title: "Un artículo de la venta está inactivo",
        description:
          "No se puede vender un artículo inactivo. La operación se rechazó y no se completó la venta.",
      };
    case "idempotency-conflict":
      return {
        title: "La operación ya se usó con otros datos",
        description:
          "La clave de idempotencia se reutilizó con otro contenido. El sistema rechazó la operación; consultá el estado de la venta antes de seguir.",
      };
    case "conflict":
      return {
        title: "No se pudo completar la venta",
        description:
          "Un cambio de estado impidió completar la venta. Actualizá la página para consultar su estado actual.",
      };
    case "validation":
      return {
        title: "La operación fue rechazada",
        description: "La solicitud no era válida y no se guardó ningún cambio.",
      };
    case "transport":
      return {
        title: "No se pudo conectar con el servidor",
        description:
          "No se recibió una respuesta, así que todavía no sabemos si la venta se completó. Actualizá la venta y verificá el estado antes de volver a intentar.",
      };
    default:
      return {
        title: "No pudimos confirmar el resultado",
        description:
          "La respuesta no permite determinar el estado final. Consultá el estado actual de la venta antes de volver a intentar.",
      };
  }
}

/** Outcomes that require an authoritative read before another command. */
export function completionNeedsStateCheck(failure: SaleCompletionFailure | null): boolean {
  return (
    failure !== null &&
    ["transport", "unknown", "not-editable", "conflict", "idempotency-conflict"].includes(failure)
  );
}

interface CompletionOutcomeAlertProps {
  /** The API's completed-sale result; present only after a confirmed completion. */
  readonly completed?: { readonly replayed: boolean } | null;
  /** The classified failure from a refused completion. */
  readonly failure?: SaleCompletionFailure | null;
}

/**
 * Renders one completion outcome. A day where the sale completed and a day where
 * it did not are visually and textually distinct, and the success branch only
 * renders when the API actually returned a completed sale.
 */
export function CompletionOutcomeAlert({
  completed = null,
  failure = null,
}: CompletionOutcomeAlertProps): JSX.Element | null {
  if (completed !== null) {
    const copy = completedOutcomeCopy(completed.replayed);
    return (
      <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm">
        <p className="font-medium text-foreground">{copy.title}</p>
        <p className="text-muted-foreground">{copy.description}</p>
      </div>
    );
  }

  if (failure === null) {
    return null;
  }

  const copy = completionFailureCopy(failure);
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <p className="font-medium">{copy.title}</p>
      <p>{copy.description}</p>
    </div>
  );
}
