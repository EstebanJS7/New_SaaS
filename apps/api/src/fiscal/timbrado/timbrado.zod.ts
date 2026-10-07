import { z } from "zod";

/**
 * FISC-011 — the request shapes, each mirroring a CHECK the database already
 * enforces. They are duplicated on purpose: the schema is the authority, and the
 * route's job is to reject a bad request with a 400 rather than let PostgreSQL
 * raise a constraint violation that reads like a server fault.
 */

/** `tRuc`: 3..8 of `[1-9][0-9]*[0-9A-D]?`. */
const rucSchema = z
  .string()
  .regex(/^[1-9][0-9]*[0-9A-D]?$/)
  .min(3)
  .max(8);
/** `tDVer`: one digit. */
const checkDigitSchema = z.string().regex(/^[0-9]$/);
/** `tdNombre`: 4..255. */
const nameSchema = z.string().min(4).max(255);
/** `tdDirec`: 1..255. */
const addressLineSchema = z.string().min(1).max(255);
/** `tcActEco`: 1..8 of `[0-9A-Z]`, with `tdDesActEco` 1..300. */
const activitySchema = z.object({
  code: z.string().regex(/^[0-9A-Z]{1,8}$/),
  description: z.string().min(1).max(300),
});

export const saveProfileBodySchema = z.object({
  ruc: rucSchema,
  checkDigit: checkDigitSchema,
  taxpayerType: z.union([z.literal(1), z.literal(2)]),
  regimeCode: z.number().int().min(1).max(8).nullable(),
  legalName: nameSchema,
  tradeName: nameSchema.nullable(),
  // `gRespDE` is optional as a whole, so the five fields travel together.
  responsibleIssuer: z
    .object({
      type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(9)]),
      typeName: z.string().min(1).max(255),
      id: z.string().regex(/^[0-9A-Za-z-]{1,20}$/),
      name: nameSchema,
      role: z.string().min(4).max(100),
    })
    .nullable(),
  transactionType: z.number().int().min(1).max(13).nullable(),
  taxType: z.number().int().min(1).max(5),
  emissionType: z.union([z.literal(1), z.literal(2)]),
  // `gActEco` is minOccurs=1: a DE with no activity is schema-invalid.
  activities: z.array(activitySchema).min(1).max(50),
});

export const saveEstablishmentBodySchema = z.object({
  code: z.string().regex(/^[0-9]{3}$/),
  addressLine: addressLineSchema,
  houseNumber: z.number().int().min(0).max(999_999),
  addressComplement1: addressLineSchema.nullable(),
  addressComplement2: addressLineSchema.nullable(),
  departmentCode: z.number().int().min(1).max(20),
  // `cDisEmi` and `dDesDisEmi` are optional together.
  district: z
    .object({
      code: z.number().int().min(1).max(9_999),
      name: z.string().min(1).max(30),
    })
    .nullable(),
  cityCode: z.number().int().min(1).max(99_999),
  cityName: z.string().min(1).max(30),
  phone: z.string().min(6).max(15),
  email: z
    .string()
    .regex(/^[0-9a-zA-Z]([0-9a-zA-Z._-])*@([0-9a-zA-Z][0-9a-zA-Z_-]*\.)+[a-zA-Z]{2,9}$/),
  branchName: z.string().min(1).max(30).nullable(),
});

/**
 * `tdFeIniT`: a date, `minInclusive` 2018-05-01.
 *
 * The regex alone accepts `2026-13-45` and `2018-04-30`, both of which the
 * column's CHECK refuses — so a bad request would surface as a constraint
 * violation rather than a 400. `Date.parse` is strict about ISO dates, and the
 * comparison is against the schema's own minimum.
 */
const validityStartSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  // A round-trip, not `Date.parse`: that one ROLLS OVER, so "2026-02-30" comes
  // back as March 2 rather than failing, and the column would refuse it.
  .refine(isCalendarDate, "Not a calendar date.")
  .refine((value) => value >= "2018-05-01", "tdFeIniT is minInclusive 2018-05-01.");

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const createRangeBodySchema = z
  .object({
    establishmentId: z.string().uuid(),
    expeditionPoint: z.string().regex(/^[0-9]{3}$/),
    // `tiTiDE` admits 1, 4, 5, 6, 7, 9 and 10, and skips 2, 3 and 8.
    documentType: z.union([
      z.literal(1),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(9),
      z.literal(10),
    ]),
    // NULL is the seriesless initial range, which is a state and not a gap.
    series: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    timbradoNumber: z
      .string()
      .regex(/^0*[1-9][0-9]*$/)
      .length(8),
    rangeFrom: z.number().int().min(1).max(9_999_999),
    rangeTo: z.number().int().min(1).max(9_999_999),
    validityStart: validityStartSchema,
  })
  // The span's own CHECK: `rangeFrom <= rangeTo`. Without it a reversed span
  // reaches the column and fails as a server fault.
  .refine((range) => range.rangeFrom <= range.rangeTo, {
    message: "rangeFrom must not exceed rangeTo.",
    path: ["rangeFrom"],
  });

export const retireRangeBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const fiscalIdParamSchema = z.object({ id: z.string().uuid() });
