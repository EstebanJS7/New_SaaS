export const STAFF_LOCALE = "es-PY";
export const DEFAULT_CLINIC_TIME_ZONE = "America/Asuncion";

const currencyFormatter = new Intl.NumberFormat(STAFF_LOCALE, {
  style: "currency",
  currency: "PYG",
  maximumFractionDigits: 0,
});

const decimalSeparator =
  new Intl.NumberFormat(STAFF_LOCALE).formatToParts(1.1).find((part) => part.type === "decimal")
    ?.value ?? ",";
const integerFormatter = new Intl.NumberFormat(STAFF_LOCALE, { maximumFractionDigits: 0 });

/** Groups an exact decimal string using es-PY punctuation without changing scale. */
export function formatEsPyDecimal(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) return amount;
  const [, sign, wholeDigits, fractionDigits = ""] = match;
  const fraction = /[1-9]/.test(fractionDigits) ? fractionDigits : "";
  const integer = integerFormatter.format(BigInt(wholeDigits));
  const exactDecimal = fraction.length === 0 ? "" : `${decimalSeparator}${fraction}`;
  return `${sign === "-" ? "-" : ""}${integer}${exactDecimal}`;
}

/** Format an API Decimal string without a Number round trip or money arithmetic. */
export function formatPygAmount(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) return amount;

  const [, sign, wholeDigits, fractionDigits = ""] = match;
  const fraction = /[1-9]/.test(fractionDigits) ? fractionDigits : "";
  const exactDecimal = fraction.length === 0 ? "" : `${decimalSeparator}${fraction}`;
  const unsigned = currencyFormatter.format(BigInt(wholeDigits));
  const groupedCurrency = sign === "-" ? `-${unsigned}` : unsigned;
  return `${groupedCurrency}${exactDecimal}`;
}

export function formatStaffMoney(amount: string, currency: string): string {
  return currency === "PYG"
    ? formatPygAmount(amount)
    : `${formatEsPyDecimal(amount)} ${currency}`.trim();
}

/**
 * API Decimal → editable local text, preserving every digit and the scale.
 * Read-only grouping must never be reused as an ambiguous wire decimal.
 */
export function formatEsPyDecimalInput(amount: string): string {
  const trimmed = amount.trim();
  return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed.replace(".", ",") : amount;
}

/** Local input uses comma decimals and optional dot grouping; never guess dot decimals. */
export function normalizeEsPyDecimalInput(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(?:(\d+)|([1-9]\d{0,2}(?:\.\d{3})+))(?:,(\d+))?$/.exec(trimmed);
  if (match === null) return null;
  const whole = (match[1] ?? match[2] ?? "").replaceAll(".", "");
  return match[3] === undefined ? whole : `${whole}.${match[3]}`;
}

/** Display a date-only field as the same calendar day in Paraguay's locale. */
export function formatEsPyDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat(STAFF_LOCALE, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Format an instant with the caller's already-resolved clinic time zone. */
export function formatEsPyInstant(
  value: string,
  timeZone: string = DEFAULT_CLINIC_TIME_ZONE
): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  return new Intl.DateTimeFormat(STAFF_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

/** Format an instant's time in the caller's already-resolved clinic zone. */
export function formatEsPyTime(value: string, timeZone: string = DEFAULT_CLINIC_TIME_ZONE): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  return new Intl.DateTimeFormat(STAFF_LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}
