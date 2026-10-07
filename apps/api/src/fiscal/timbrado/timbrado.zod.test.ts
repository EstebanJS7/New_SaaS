/**
 * FISC-011 WU-E — the request shapes.
 *
 * The schemas mirror CHECKs the database already enforces, and the point of
 * mirroring them is that a bad request is a 400 rather than a constraint
 * violation that reads like a server fault. So the cases below are exactly the
 * ones the column would otherwise refuse.
 */

import { describe, expect, it } from "vitest";
import { createRangeBodySchema, saveProfileBodySchema } from "./timbrado.zod.js";

const RANGE = {
  establishmentId: "22222222-2222-4222-8222-222222222222",
  expeditionPoint: "001",
  documentType: 1,
  series: null,
  timbradoNumber: "12345678",
  rangeFrom: 1,
  rangeTo: 9_999_999,
  validityStart: "2019-09-01",
} as const;

describe("the timbrado range body", () => {
  it("accepts a well-formed range", () => {
    expect(createRangeBodySchema.safeParse(RANGE).success).toBe(true);
  });

  it("refuses a span whose floor exceeds its ceiling", () => {
    // The column's `range_from <= range_to` CHECK. Without the refinement this
    // reaches PostgreSQL and fails as a server fault.
    const parsed = createRangeBodySchema.safeParse({ ...RANGE, rangeFrom: 500, rangeTo: 100 });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : String(parsed.error.issues[0]?.message)).toMatch(
      /rangeFrom must not exceed rangeTo/
    );
  });

  it("refuses a date that is not a calendar date", () => {
    // The regex accepts this; Date.parse does not.
    expect(createRangeBodySchema.safeParse({ ...RANGE, validityStart: "2026-13-45" }).success).toBe(
      false
    );
    expect(createRangeBodySchema.safeParse({ ...RANGE, validityStart: "2026-02-30" }).success).toBe(
      false
    );
  });

  it("refuses a date before the schema's minimum", () => {
    // `tdFeIniT` is minInclusive 2018-05-01, which the column enforces too.
    expect(createRangeBodySchema.safeParse({ ...RANGE, validityStart: "2018-04-30" }).success).toBe(
      false
    );
    expect(createRangeBodySchema.safeParse({ ...RANGE, validityStart: "2018-05-01" }).success).toBe(
      true
    );
  });

  it("refuses the document types tiTiDE skips", () => {
    for (const documentType of [2, 3, 8]) {
      expect(createRangeBodySchema.safeParse({ ...RANGE, documentType }).success).toBe(false);
    }
    for (const documentType of [1, 4, 5, 6, 7, 9, 10]) {
      expect(createRangeBodySchema.safeParse({ ...RANGE, documentType }).success).toBe(true);
    }
  });

  it("refuses an all-zero timbrado number and a malformed series", () => {
    expect(createRangeBodySchema.safeParse({ ...RANGE, timbradoNumber: "00000000" }).success).toBe(
      false
    );
    // Ñ is not in A-Z, which is the whole reason the series rule needs no special
    // case.
    expect(createRangeBodySchema.safeParse({ ...RANGE, series: "ÑA" }).success).toBe(false);
    expect(createRangeBodySchema.safeParse({ ...RANGE, series: "AA" }).success).toBe(true);
  });
});

describe("the emitter profile body", () => {
  const PROFILE = {
    ruc: "80012345",
    checkDigit: "6",
    taxpayerType: 2,
    regimeCode: 8,
    legalName: "Clínica Veterinaria del Sur S.A.",
    tradeName: null,
    responsibleIssuer: null,
    transactionType: 1,
    taxType: 1,
    emissionType: 1,
    activities: [{ code: "47730", description: "Venta al por menor" }],
  };

  it("accepts a well-formed profile", () => {
    expect(saveProfileBodySchema.safeParse(PROFILE).success).toBe(true);
  });

  it("refuses an empty gActEco, which the schema requires", () => {
    expect(saveProfileBodySchema.safeParse({ ...PROFILE, activities: [] }).success).toBe(false);
  });

  it("refuses the taxpayer types tiTipCont does not admit", () => {
    expect(saveProfileBodySchema.safeParse({ ...PROFILE, taxpayerType: 3 }).success).toBe(false);
  });

  it("refuses a responsible issuer whose type is outside tiTipIDRespDE", () => {
    const issuer = { type: 5, typeName: "X", id: "1", name: "Ana Pérez", role: "Contadora" };
    expect(saveProfileBodySchema.safeParse({ ...PROFILE, responsibleIssuer: issuer }).success).toBe(
      false
    );
    expect(
      saveProfileBodySchema.safeParse({ ...PROFILE, responsibleIssuer: { ...issuer, type: 9 } })
        .success
    ).toBe(true);
  });

  it("refuses a RUC that does not match tRuc", () => {
    expect(saveProfileBodySchema.safeParse({ ...PROFILE, ruc: "012345" }).success).toBe(false);
    expect(saveProfileBodySchema.safeParse({ ...PROFILE, ruc: "80012345678" }).success).toBe(false);
  });
});
