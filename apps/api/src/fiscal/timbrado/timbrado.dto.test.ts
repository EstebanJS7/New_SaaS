/**
 * FISC-018 review — the response mappers carry every saved field the edit forms
 * prefill, so a `PUT` that replaces the whole row never asks the operator to
 * retype what the API already holds.
 */

import { describe, expect, it } from "vitest";
import { toEmitterProfileResponse, toEstablishmentResponse } from "./timbrado.dto.js";
import type { EmitterProfileView, EstablishmentView } from "./timbrado.service.js";

const AT = new Date("2026-10-07T00:00:00Z");

describe("the emitter profile response", () => {
  const view: EmitterProfileView = {
    ruc: "80012345",
    checkDigit: "6",
    taxpayerType: 2,
    regimeCode: null,
    legalName: "Clínica Veterinaria del Sur S.A.",
    tradeName: null,
    responsibleIssuer: {
      type: 1,
      typeName: "Cédula paraguaya",
      id: "1234567",
      name: "Ana Pérez",
      role: "Contadora",
    },
    transactionType: 1,
    taxType: 1,
    emissionType: 1,
    activities: [{ code: "47730", description: "Venta al por menor" }],
    issuancePoint: null,
    createdAt: AT,
    updatedAt: AT,
  };

  it("carries the responsible issuer, or null while none is declared", () => {
    expect(toEmitterProfileResponse(view).responsibleIssuer).toEqual(view.responsibleIssuer);
    expect(
      toEmitterProfileResponse({ ...view, responsibleIssuer: null }).responsibleIssuer
    ).toBeNull();
  });
});

describe("the establishment response", () => {
  it("carries every saved field", () => {
    const view: EstablishmentView = {
      id: "22222222-2222-4222-8222-222222222222",
      code: "001",
      addressLine: "Av. Mcal. López",
      houseNumber: 1234,
      addressComplement1: "Piso 2",
      addressComplement2: null,
      departmentCode: 1,
      districtCode: 1,
      districtName: "ASUNCION",
      cityCode: 1,
      cityName: "ASUNCION",
      phone: "021123456",
      email: "fiscal@vetsur.example",
      branchName: "Central",
      createdAt: AT,
      updatedAt: AT,
    };
    expect(toEstablishmentResponse(view)).toEqual({
      ...view,
      createdAt: AT.toISOString(),
      updatedAt: AT.toISOString(),
    });
  });
});
