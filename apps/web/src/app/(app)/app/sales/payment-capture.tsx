"use client";

import type { JSX } from "react";
import { useRef, useState } from "react";
import { Button } from "@newsaas/ui/components/ui/button";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  formatEsPyDecimalInput,
  formatStaffMoney,
  normalizeEsPyDecimalInput,
} from "@/lib/es-py-format";
import {
  PAYMENT_METHODS,
  isWirePaymentAmount,
  type PaymentCardBrand,
  type PaymentCardType,
  type PaymentMethod,
  type PaymentQrKind,
  type SalePaymentInput,
} from "./sales-api";
import {
  PAYMENT_CARD_BRAND_LABELS,
  PAYMENT_CARD_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_QR_KIND_LABELS,
} from "./sales-display";
import { addWireDecimals, paymentsSumExactly } from "./wire-decimal";

const inputClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * One locally entered payment; every value stays a string until submit. The
 * detail fields (PAY-DET-001) are only read for the method they belong to.
 */
interface PaymentDraft {
  readonly key: string;
  readonly method: PaymentMethod;
  readonly amount: string;
  readonly cardType: PaymentCardType | "";
  readonly cardBrand: PaymentCardBrand | "";
  readonly cardBrandName: string;
  readonly qrKind: PaymentQrKind | "";
  readonly checkNumber: string;
  readonly checkBank: string;
  readonly otherDescription: string;
}

const EMPTY_DETAIL = {
  cardType: "",
  cardBrand: "",
  cardBrandName: "",
  qrKind: "",
  checkNumber: "",
  checkBank: "",
  otherDescription: "",
} as const;

const CARD_TYPES = Object.keys(PAYMENT_CARD_TYPE_LABELS) as PaymentCardType[];
const CARD_BRANDS = Object.keys(PAYMENT_CARD_BRAND_LABELS) as PaymentCardBrand[];
const QR_KINDS = Object.keys(PAYMENT_QR_KIND_LABELS) as PaymentQrKind[];

function lengthBetween(value: string, min: number, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max;
}

/**
 * PAY-DET-001 / DEC-091: what SIFEN needs to describe this payment on the
 * factura electrónica. `null` when complete, otherwise the sentence to show.
 */
export function paymentDetailProblem(payment: PaymentDraft): string | null {
  switch (payment.method) {
    case "CARD":
      if (payment.cardType === "" || payment.cardBrand === "") {
        return "Elegí si la tarjeta es de crédito o de débito, y su marca.";
      }
      if (payment.cardBrand === "OTHER" && !lengthBetween(payment.cardBrandName, 4, 20)) {
        return "Escribí el nombre de la marca (de 4 a 20 caracteres).";
      }
      return null;
    case "QR":
      return payment.qrKind === ""
        ? "Elegí si el QR es de una billetera o de la app del banco."
        : null;
    case "CHECK":
      if (
        !/^[0-9]{1,8}$/.test(payment.checkNumber.trim()) ||
        !lengthBetween(payment.checkBank, 4, 20)
      ) {
        return "Escribí el número del cheque (hasta 8 dígitos) y el banco (de 4 a 20 caracteres).";
      }
      return null;
    case "OTHER":
      return lengthBetween(payment.otherDescription, 4, 30)
        ? null
        : "Describí el medio de pago (de 4 a 30 caracteres).";
    default:
      return null;
  }
}

/** The wire payment, with only the detail its method takes. */
function toPaymentInput(payment: PaymentDraft): SalePaymentInput {
  const amount = normalizeEsPyDecimalInput(payment.amount) ?? payment.amount.trim();
  switch (payment.method) {
    case "CARD":
      return {
        method: payment.method,
        amount,
        card: {
          type: payment.cardType as PaymentCardType,
          brand: payment.cardBrand as PaymentCardBrand,
          ...(payment.cardBrand === "OTHER" ? { brandName: payment.cardBrandName.trim() } : {}),
        },
      };
    case "QR":
      return { method: payment.method, amount, qrKind: payment.qrKind as PaymentQrKind };
    case "CHECK":
      return {
        method: payment.method,
        amount,
        check: { number: payment.checkNumber.trim(), bank: payment.checkBank.trim() },
      };
    case "OTHER":
      return { method: payment.method, amount, otherDescription: payment.otherDescription.trim() };
    default:
      return { method: payment.method, amount };
  }
}

/** How the review lists a payment: "Tarjeta · Crédito Visa". */
function paymentLabel(payment: PaymentDraft): string {
  const base = PAYMENT_METHOD_LABELS[payment.method];
  if (payment.method === "CARD" && payment.cardType !== "" && payment.cardBrand !== "") {
    const brand =
      payment.cardBrand === "OTHER"
        ? payment.cardBrandName.trim()
        : PAYMENT_CARD_BRAND_LABELS[payment.cardBrand];
    return `${base} · ${PAYMENT_CARD_TYPE_LABELS[payment.cardType]} ${brand}`;
  }
  if (payment.method === "QR" && payment.qrKind !== "") {
    return `${base} · ${PAYMENT_QR_KIND_LABELS[payment.qrKind]}`;
  }
  if (payment.method === "CHECK") return `${base} N° ${payment.checkNumber.trim()}`;
  if (payment.method === "OTHER") return `${base} · ${payment.otherDescription.trim()}`;
  return base;
}

interface PaymentCaptureProps {
  /** The sale total the API computed, as an exact fixed-scale decimal string. */
  readonly total: string;
  /** The sale's currency, rendered as its own field and never converted. */
  readonly currency: string;
  readonly onSubmit: (payments: SalePaymentInput[]) => void | Promise<unknown>;
  readonly isPending: boolean;
  readonly errorMessage?: string;
  readonly disabled?: boolean;
}

/**
 * The payment capture (EPIC-12 POS-004, DEC-029).
 *
 * It accepts one or several payments across the six PRD §19 methods, shows the
 * exact sum of what was entered against the sale total, and refuses to submit a
 * set that does not sum exactly. The sum and the comparison are exact decimal
 * arithmetic over the wire strings ({@link addWireDecimals},
 * {@link paymentsSumExactly}) — no money literal is ever parsed into a
 * JavaScript number.
 *
 * There is deliberately no tendered amount, no change and no customer credit
 * field: the sale is settled when the payments sum exactly, and the API enforces
 * the same rule authoritatively. The first payment starts at the total so a
 * single-method sale is one keystroke, and it stays editable.
 */
export function PaymentCapture({
  total,
  currency,
  onSubmit,
  isPending,
  errorMessage,
  disabled = false,
}: PaymentCaptureProps): JSX.Element {
  const nextKeyRef = useRef(1);
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { key: "payment-0", method: "CASH", amount: formatEsPyDecimalInput(total), ...EMPTY_DETAIL },
  ]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const normalizedAmounts = payments.map((payment) => normalizeEsPyDecimalInput(payment.amount));
  const exactAmounts = normalizedAmounts.filter(
    (amount): amount is string => amount !== null && isWirePaymentAmount(amount)
  );
  const everyAmountValid = payments.length > 0 && exactAmounts.length === payments.length;
  const exact = everyAmountValid && paymentsSumExactly(exactAmounts, total);
  const detailsComplete = payments.every((payment) => paymentDetailProblem(payment) === null);
  const ready = exact && detailsComplete;
  const sum = everyAmountValid ? addWireDecimals(exactAmounts) : null;
  const isLocked = disabled || isPending;

  function setPayment(key: string, patch: Partial<Omit<PaymentDraft, "key">>): void {
    setPayments((previous) =>
      previous.map((payment) => (payment.key === key ? { ...payment, ...patch } : payment))
    );
  }

  function addPayment(): void {
    const key = `payment-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    setPayments((previous) => [...previous, { key, method: "CARD", amount: "", ...EMPTY_DETAIL }]);
  }

  function removePayment(key: string): void {
    setPayments((previous) =>
      previous.length > 1 ? previous.filter((payment) => payment.key !== key) : previous
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || isLocked) {
      return;
    }
    setReviewOpen(true);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-3">
        {payments.map((payment, index) => (
          <div
            key={payment.key}
            className="grid gap-3 rounded-lg border border-input p-3 sm:grid-cols-2"
          >
            <div className="space-y-2">
              <label htmlFor={`${payment.key}-method`} className="text-sm font-medium">
                {`Medio de pago ${index + 1}`}
              </label>
              <select
                id={`${payment.key}-method`}
                value={payment.method}
                onChange={(event) =>
                  setPayment(payment.key, { method: event.target.value as PaymentMethod })
                }
                disabled={isLocked}
                className={inputClassName}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor={`${payment.key}-amount`} className="text-sm font-medium">
                {`Importe del pago ${index + 1}`}
              </label>
              <input
                id={`${payment.key}-amount`}
                type="text"
                inputMode="decimal"
                value={payment.amount}
                onChange={(event) => setPayment(payment.key, { amount: event.target.value })}
                disabled={isLocked}
                placeholder="0"
                aria-invalid={
                  normalizeEsPyDecimalInput(payment.amount) === null ||
                  !isWirePaymentAmount(normalizeEsPyDecimalInput(payment.amount) ?? "")
                }
                aria-describedby={
                  normalizeEsPyDecimalInput(payment.amount) === null ||
                  !isWirePaymentAmount(normalizeEsPyDecimalInput(payment.amount) ?? "")
                    ? `${payment.key}-amount-hint payment-exact-sum-help`
                    : "payment-exact-sum-help"
                }
                className={inputClassName}
              />
              {(normalizeEsPyDecimalInput(payment.amount) === null ||
                !isWirePaymentAmount(normalizeEsPyDecimalInput(payment.amount) ?? "")) && (
                <p id={`${payment.key}-amount-hint`} className="text-xs text-destructive">
                  Ingresá un importe positivo con hasta dos decimales. Usá coma para los decimales y
                  punto para los miles.
                </p>
              )}
            </div>
            <PaymentDetailFields
              payment={payment}
              disabled={isLocked}
              onChange={(patch) => setPayment(payment.key, patch)}
            />
            <div className="flex justify-end sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => removePayment(payment.key)}
                disabled={isLocked || payments.length === 1}
              >
                Quitar pago
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={addPayment} disabled={isLocked}>
          Agregar medio de pago
        </Button>
        <p className="text-sm text-muted-foreground" aria-label="Total de la venta">
          {`Total de la venta: ${formatStaffMoney(total, currency)}`}
        </p>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={exact ? "text-sm text-foreground" : "text-sm text-destructive"}
        data-testid="payment-sum"
      >
        {`Suma de pagos: ${sum === null ? "no disponible" : formatStaffMoney(sum, currency)}.`}
      </p>

      <p
        id="payment-exact-sum-help"
        className={exact ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
      >
        Los importes deben sumar exactamente el total de la venta. No se calcula vuelto ni se acepta
        saldo a crédito.
      </p>

      <Button type="submit" disabled={!ready || isLocked}>
        {isPending ? "Confirmando venta…" : "Revisar venta"}
      </Button>
      <ConfirmActionDialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!open && !isPending) setReviewOpen(false);
        }}
        title="Revisar y confirmar venta"
        description="Verificá el total calculado por el sistema y cómo se distribuye el pago. La venta solo se completa si el servidor confirma la operación."
        confirmLabel="Confirmar venta"
        confirmVariant="default"
        pending={isPending}
        confirmDisabled={disabled || !ready}
        pendingLabel="Confirmando venta…"
        errorMessage={errorMessage}
        onConfirm={async () => {
          if (isLocked) throw new Error("Consultá el estado de la venta antes de continuar.");
          if (!exact) throw new Error("Los pagos ya no coinciden con el total.");
          if (!detailsComplete) throw new Error("Completá los datos de cada pago.");
          await onSubmit(payments.map(toPaymentInput));
        }}
      >
        <div className="mt-4 space-y-3">
          <dl className="space-y-3 rounded-lg border border-border p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Total de la venta</dt>
              <dd className="font-semibold tabular-nums">{formatStaffMoney(total, currency)}</dd>
            </div>
            {payments.map((payment, index) => (
              <div key={payment.key} className="flex items-center justify-between gap-4">
                <dt>
                  {paymentLabel(payment)} · pago {index + 1}
                </dt>
                <dd className="tabular-nums">
                  {formatStaffMoney(
                    normalizeEsPyDecimalInput(payment.amount) ?? payment.amount.trim(),
                    currency
                  )}
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 border-t border-border pt-3 font-medium">
              <dt>Suma de pagos</dt>
              <dd className="tabular-nums">
                {sum === null ? "No disponible" : formatStaffMoney(sum, currency)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            El importe debe coincidir exactamente. No se calcula vuelto ni se registra crédito.
          </p>
        </div>
      </ConfirmActionDialog>
    </form>
  );
}

/**
 * PAY-DET-001 / DEC-091: the per-method fields a factura electrónica needs.
 * Nothing renders for cash or a bank transfer, which SIFEN describes by type.
 */
function PaymentDetailFields({
  payment,
  disabled,
  onChange,
}: {
  readonly payment: PaymentDraft;
  readonly disabled: boolean;
  readonly onChange: (patch: Partial<Omit<PaymentDraft, "key">>) => void;
}): JSX.Element | null {
  const id = payment.key;
  const problem = paymentDetailProblem(payment);
  const hint =
    problem === null ? null : (
      <p id={`${id}-detail-hint`} className="text-xs text-destructive sm:col-span-2">
        {problem}
      </p>
    );
  const field = (suffix: string, label: string, control: JSX.Element): JSX.Element => (
    <div className="space-y-2">
      <label htmlFor={`${id}-${suffix}`} className="text-sm font-medium">
        {label}
      </label>
      {control}
    </div>
  );

  if (payment.method === "CARD") {
    return (
      <>
        {field(
          "card-type",
          "Tipo de tarjeta",
          <select
            id={`${id}-card-type`}
            value={payment.cardType}
            onChange={(event) => onChange({ cardType: event.target.value as PaymentCardType })}
            disabled={disabled}
            className={inputClassName}
          >
            <option value="">Elegí…</option>
            {CARD_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAYMENT_CARD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        )}
        {field(
          "card-brand",
          "Marca de la tarjeta",
          <select
            id={`${id}-card-brand`}
            value={payment.cardBrand}
            onChange={(event) => onChange({ cardBrand: event.target.value as PaymentCardBrand })}
            disabled={disabled}
            className={inputClassName}
          >
            <option value="">Elegí…</option>
            {CARD_BRANDS.map((brand) => (
              <option key={brand} value={brand}>
                {PAYMENT_CARD_BRAND_LABELS[brand]}
              </option>
            ))}
          </select>
        )}
        {payment.cardBrand === "OTHER" &&
          field(
            "card-brand-name",
            "Nombre de la marca",
            <input
              id={`${id}-card-brand-name`}
              type="text"
              maxLength={20}
              value={payment.cardBrandName}
              onChange={(event) => onChange({ cardBrandName: event.target.value })}
              disabled={disabled}
              className={inputClassName}
            />
          )}
        {hint}
      </>
    );
  }
  if (payment.method === "QR") {
    return (
      <>
        {field(
          "qr-kind",
          "Tipo de QR",
          <select
            id={`${id}-qr-kind`}
            value={payment.qrKind}
            onChange={(event) => onChange({ qrKind: event.target.value as PaymentQrKind })}
            disabled={disabled}
            className={inputClassName}
          >
            <option value="">Elegí…</option>
            {QR_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PAYMENT_QR_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        )}
        {hint}
      </>
    );
  }
  if (payment.method === "CHECK") {
    return (
      <>
        {field(
          "check-number",
          "Número de cheque",
          <input
            id={`${id}-check-number`}
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={payment.checkNumber}
            onChange={(event) => onChange({ checkNumber: event.target.value })}
            disabled={disabled}
            className={inputClassName}
          />
        )}
        {field(
          "check-bank",
          "Banco del cheque",
          <input
            id={`${id}-check-bank`}
            type="text"
            maxLength={20}
            value={payment.checkBank}
            onChange={(event) => onChange({ checkBank: event.target.value })}
            disabled={disabled}
            className={inputClassName}
          />
        )}
        {hint}
      </>
    );
  }
  if (payment.method === "OTHER") {
    return (
      <>
        {field(
          "other-description",
          "Descripción del medio de pago",
          <input
            id={`${id}-other-description`}
            type="text"
            maxLength={30}
            value={payment.otherDescription}
            onChange={(event) => onChange({ otherDescription: event.target.value })}
            disabled={disabled}
            className={inputClassName}
          />
        )}
        {hint}
      </>
    );
  }
  return null;
}
