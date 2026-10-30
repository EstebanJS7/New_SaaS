import { normalizeEsPyDecimalInput } from "@/lib/es-py-format";
import type { WeightSearchInput } from "./weight-search-api";

function thousandths(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
/** Exact range validation for this read surface, independent of measurement unit. */
export function parseWeightRange(
  min: string,
  max: string
):
  | { ok: true; value: Pick<WeightSearchInput, "minQuantity" | "maxQuantity"> }
  | { ok: false; message: string } {
  const bounds = [min, max].map((value) =>
    value.trim() === "" ? undefined : normalizeEsPyDecimalInput(value)
  );
  if (
    bounds.some(
      (value) =>
        value !== undefined &&
        (value === null || !/^\d{1,7}(\.\d{1,3})?$/.test(value) || thousandths(value) <= 0n)
    )
  )
    return {
      ok: false,
      message:
        "Ingresá valores positivos de hasta 7 dígitos enteros y 3 decimales, con coma decimal, o dejá los límites vacíos.",
    };
  const minQuantity = bounds[0] ?? undefined,
    maxQuantity = bounds[1] ?? undefined;
  if (
    minQuantity !== undefined &&
    maxQuantity !== undefined &&
    thousandths(minQuantity) > thousandths(maxQuantity)
  )
    return { ok: false, message: "El valor mínimo no puede ser mayor que el máximo." };
  return { ok: true, value: { minQuantity, maxQuantity } };
}
