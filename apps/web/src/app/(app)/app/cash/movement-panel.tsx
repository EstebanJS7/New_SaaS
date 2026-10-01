"use client";

import type { JSX } from "react";
import { useRef, useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import {
  CASH_MOVEMENT_DIRECTIONS,
  CASH_MOVEMENT_TYPES,
  type CashMovement,
  type CashMovementDirection,
  type CashMovementType,
  type CashSession,
  type CreateCashMovementInput,
} from "./cash-api";
import {
  CASH_MOVEMENT_DIRECTION_LABELS,
  CASH_MOVEMENT_TYPE_LABELS,
  cashInputClassName,
  cashTextareaClassName,
  formatCashAmount,
  formatDate,
  shortId,
} from "./cash-display";
import { CashErrorAlert } from "./cash-outcome";
import { cashMovementDraftError, type CashMovementDraft } from "./cash-validation";

interface MovementPanelProps {
  /** The selected session, or `null` before one is chosen. */
  readonly session: CashSession | null;
  /** The selected session's movements, newest first, as the API returned them. */
  readonly movements: readonly CashMovement[];
  readonly isLoading: boolean;
  readonly loadError: Error | null;
  /**
   * Creates one movement. The idempotency key is minted by this panel, so the
   * caller forwards it verbatim and the API can replay an identical retry
   * (DEC-024).
   */
  readonly onCreate: (input: CreateCashMovementInput, idempotencyKey: string) => Promise<void>;
  readonly isCreating: boolean;
  readonly createError: Error | null;
  /** The movement the API just created, present only after a confirmed create. */
  readonly created: CashMovement | null;
}

const EMPTY_DRAFT: CashMovementDraft = {
  type: "INCOME",
  amount: "",
  reason: "",
  direction: "",
};

/**
 * The movement panel (EPIC-13 CASH-004).
 *
 * Lists the selected session's immutable ledger and records one manual movement.
 * The ledger entry is immutable: there is no edit and no delete control anywhere,
 * and `SALE` is deliberately absent from the kind list because a sale-generated
 * movement is written only by sale completion (DEC-020/033).
 *
 * The amount the operator enters is POSITIVE — the type owns the sign (DEC-030) —
 * and the direction control only exists for `ADJUSTMENT`, which is the one kind
 * that carries an explicit sign. The reason is required for every kind but
 * `INCOME` (DEC-032); the local checks mirror the API, which remains the only
 * validator.
 *
 * IDEMPOTENCY (DEC-024): the movement create requires an `Idempotency-Key` and
 * the cash client never mints one. This panel mints exactly one key per create
 * attempt and keeps it until a create is CONFIRMED: a retry of an unresolved
 * attempt reuses the same key, so the API replays the stored movement instead of
 * writing a second one, and the key only rotates after a successful create,
 * because the next movement is a new intent. Nothing about the key is derived
 * from the form, so editing the form between retries still replays rather than
 * double-posts.
 */
export function MovementPanel({
  session,
  movements,
  isLoading,
  loadError,
  onCreate,
  isCreating,
  createError,
  created,
}: MovementPanelProps): JSX.Element {
  const [draft, setDraft] = useState<CashMovementDraft>(EMPTY_DRAFT);
  const [localError, setLocalError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  /** Mints the attempt's key lazily, or returns the one the attempt already owns. */
  function idempotencyKeyForAttempt(): string {
    idempotencyKeyRef.current ??= crypto.randomUUID();
    return idempotencyKeyRef.current;
  }

  async function submitMovement(): Promise<void> {
    if (session === null) {
      return;
    }
    const error = cashMovementDraftError(draft);
    if (error !== null) {
      setLocalError(error);
      return;
    }
    setLocalError(null);
    const reason = draft.reason.trim();
    const input: CreateCashMovementInput = {
      sessionId: session.id,
      type: draft.type,
      amount: draft.amount.trim(),
      // The reason is omitted only for `INCOME`, where it is optional.
      ...(reason.length > 0 ? { reason } : {}),
      // The direction is sent exactly for `ADJUSTMENT` and never otherwise.
      ...(draft.type === "ADJUSTMENT"
        ? { direction: draft.direction as CashMovementDirection }
        : {}),
    };
    try {
      await onCreate(input, idempotencyKeyForAttempt());
      // A confirmed create closes the attempt: the next movement is a new intent
      // and must not reuse the key that already identified this one.
      idempotencyKeyRef.current = null;
      setDraft({ ...EMPTY_DRAFT, type: draft.type });
    } catch {
      // The attempt is unresolved: keep the key so a retry replays the stored
      // movement instead of writing a second one.
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitMovement();
  }

  function changeType(type: CashMovementType): void {
    // A direction is only ever sent for `ADJUSTMENT`, so switching away from it
    // clears the choice instead of leaving a value the API would refuse.
    setDraft((previous) => ({
      ...previous,
      type,
      direction: type === "ADJUSTMENT" ? previous.direction : "",
    }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Movements</CardTitle>
        <CardDescription>
          {session === null
            ? "Select a session to see its immutable ledger."
            : `The immutable ledger of the selected session. Amounts are positive; the movement type owns the sign (DEC-030).`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {session === null ? (
          <p data-testid="movements-no-session" className="text-sm text-muted-foreground">
            Select a session above to view its movements and record a manual one.
          </p>
        ) : (
          <>
            {isLoading ? (
              <p data-testid="movements-loading" className="text-sm text-muted-foreground">
                Loading cash movements...
              </p>
            ) : loadError !== null ? (
              <CashErrorAlert error={loadError} testId="movements-error" />
            ) : movements.length === 0 ? (
              <p data-testid="movements-empty" className="text-sm text-muted-foreground">
                No movements recorded for this session yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {movements.map((movement) => (
                  <li
                    key={movement.id}
                    className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {movement.direction === null
                          ? CASH_MOVEMENT_TYPE_LABELS[movement.type]
                          : `${CASH_MOVEMENT_TYPE_LABELS[movement.type]} · ${CASH_MOVEMENT_DIRECTION_LABELS[movement.direction]}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {`#${shortId(movement.id)} · ${formatDate(movement.createdAt)}${movement.reason === null ? "" : ` · ${movement.reason}`}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-sm text-foreground">
                      {formatCashAmount(movement.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {created !== null && (
              <div
                role="status"
                data-testid="movement-created"
                className="rounded-lg border border-border bg-muted p-4 text-sm"
              >
                <p className="font-medium text-foreground">Movement recorded</p>
                <p className="text-muted-foreground">
                  {`The API stored this ${CASH_MOVEMENT_TYPE_LABELS[created.type].toLowerCase()} movement of ${formatCashAmount(created.amount)}. The ledger entry is immutable.`}
                </p>
              </div>
            )}

            {createError !== null && (
              <CashErrorAlert error={createError} testId="movement-create-error" />
            )}

            {session.status === "OPEN" ? (
              <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <label htmlFor="cash-movement-type" className="text-sm font-medium">
                    Movement type
                  </label>
                  <select
                    id="cash-movement-type"
                    value={draft.type}
                    onChange={(event) => changeType(event.target.value as CashMovementType)}
                    disabled={isCreating}
                    className={cashInputClassName}
                  >
                    {CASH_MOVEMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {CASH_MOVEMENT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="cash-movement-amount" className="text-sm font-medium">
                    Amount
                  </label>
                  <input
                    id="cash-movement-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.amount}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, amount: event.target.value }))
                    }
                    disabled={isCreating}
                    placeholder="0.00"
                    className={cashInputClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    A positive amount; the movement type decides whether expected cash rises or
                    falls.
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="cash-movement-reason" className="text-sm font-medium">
                    Reason
                  </label>
                  <textarea
                    id="cash-movement-reason"
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, reason: event.target.value }))
                    }
                    disabled={isCreating}
                    placeholder="Why the cash moved"
                    className={cashTextareaClassName}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for every kind except income, where it is optional.
                  </p>
                </div>

                {draft.type === "ADJUSTMENT" && (
                  <div className="space-y-2">
                    <label htmlFor="cash-movement-direction" className="text-sm font-medium">
                      Adjustment direction
                    </label>
                    <select
                      id="cash-movement-direction"
                      value={draft.direction}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          direction: event.target.value as CashMovementDirection | "",
                        }))
                      }
                      disabled={isCreating}
                      className={cashInputClassName}
                    >
                      <option value="">Select a direction</option>
                      {CASH_MOVEMENT_DIRECTIONS.map((direction) => (
                        <option key={direction} value={direction}>
                          {CASH_MOVEMENT_DIRECTION_LABELS[direction]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {localError !== null && (
                  <p
                    role="alert"
                    data-testid="movement-validation-error"
                    className="text-sm text-destructive"
                  >
                    {localError}
                  </p>
                )}

                <Button type="submit" disabled={isCreating}>
                  {isCreating ? "Recording movement..." : "Record movement"}
                </Button>
              </form>
            ) : (
              <p data-testid="movements-session-closed" className="text-sm text-muted-foreground">
                This session is closed. Its ledger is immutable and no further movement can be
                recorded against it. Open a new session to record one.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
