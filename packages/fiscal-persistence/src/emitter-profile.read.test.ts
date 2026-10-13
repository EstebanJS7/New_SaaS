/**
 * FISC-012 WU-B — the profile read.
 *
 * The adapter's whole content is the SHAPE of its statements and the mapping of
 * each column, so that is what this suite asserts: the tenant is in every
 * `where`, the activities are read in their stored order, and every `Stored*`
 * field comes from the column it names. The fake client records what it was
 * asked to do and answers from rows that carry extra columns, so a mapping that
 * passed Prisma's row through untouched would fail here.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import { describe, expect, it } from "vitest";
import {
  createFiscalProfileReader,
  type FiscalEmitterProfileRow,
  type FiscalProfileReadClient,
} from "./emitter-profile.read.js";

/** A key a value must carry: an optional key resolves to `never` here. */
type RequiredRowKey<K extends keyof FiscalEmitterProfileRow> =
  Record<never, never> extends Pick<FiscalEmitterProfileRow, K> ? never : K;

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ESTABLISHMENT_ID = "33333333-3333-4333-8333-333333333333";

/** The row carries more than the stored shape: the extra columns must not leak. */
const PROFILE_ROW = {
  id: "44444444-4444-4444-8444-444444444444",
  tenantId: TENANT_A,
  ruc: "80012345",
  checkDigit: "6",
  taxpayerType: 2,
  regimeCode: 8,
  legalName: "Veterinaria Sur S.A.",
  tradeName: "VetSur",
  responsibleIssuerType: 1,
  responsibleIssuerTypeName: "Cédula de identidad",
  responsibleIssuerId: "1234567",
  responsibleIssuerName: "Ana Pérez",
  responsibleIssuerRole: "Representante legal",
  transactionType: 1,
  taxType: 1,
  emissionType: 1,
  defaultEstablishmentId: ESTABLISHMENT_ID,
  defaultExpeditionPoint: "001",
  defaultDocumentType: 1,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
};

const ACTIVITY_ROWS = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    tenantId: TENANT_A,
    profileId: PROFILE_ROW.id,
    position: 0,
    code: "G47111",
    description: "Venta al por menor",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    tenantId: TENANT_A,
    profileId: PROFILE_ROW.id,
    position: 1,
    code: "M75000",
    description: "Actividades veterinarias",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
  },
];

const ESTABLISHMENT_ROW = {
  id: ESTABLISHMENT_ID,
  tenantId: TENANT_A,
  code: "001",
  addressLine: "Av. Mcal. López",
  houseNumber: 1234,
  addressComplement1: "Edificio Aurora",
  addressComplement2: "Piso 2",
  departmentCode: 1,
  districtCode: 7,
  districtName: "ASUNCION",
  cityCode: 7,
  cityName: "ASUNCION",
  phone: "021123456",
  email: "fiscal@vetsur.example",
  branchName: "Casa central",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
};

/** Records every call, and answers from the rows in its own tenant's scope. */
class ScopedClient implements FiscalProfileReadClient {
  readonly findUniqueArgs: Prisma.FiscalEmitterProfileFindUniqueArgs[] = [];
  readonly findManyArgs: Prisma.FiscalEmitterActivityFindManyArgs[] = [];
  readonly findFirstArgs: Prisma.FiscalEstablishmentFindFirstArgs[] = [];

  readonly fiscalEmitterProfile: FiscalProfileReadClient["fiscalEmitterProfile"];
  readonly fiscalEmitterActivity: FiscalProfileReadClient["fiscalEmitterActivity"];
  readonly fiscalEstablishment: FiscalProfileReadClient["fiscalEstablishment"];

  constructor(private readonly profileRow: FiscalEmitterProfileRow = PROFILE_ROW) {
    this.fiscalEmitterProfile = {
      findUnique: (args) => {
        this.findUniqueArgs.push(args);
        return Promise.resolve(args.where.tenantId === TENANT_A ? this.profileRow : null);
      },
    };
    this.fiscalEmitterActivity = {
      findMany: (args) => {
        this.findManyArgs.push(args);
        return Promise.resolve(args.where?.profileId === PROFILE_ROW.id ? ACTIVITY_ROWS : []);
      },
    };
    this.fiscalEstablishment = {
      findFirst: (args) => {
        this.findFirstArgs.push(args);
        const where = args.where ?? {};
        const matches = where.tenantId === TENANT_A && where.id === ESTABLISHMENT_ID;
        return Promise.resolve(matches ? ESTABLISHMENT_ROW : null);
      },
    };
  }
}

describe("readProfile", () => {
  it("fits the real Prisma client by construction", () => {
    // Compile-time: the client is declared with Prisma's own argument types, so
    // `PrismaService` is assignable without a cast. A Prisma upgrade that stops
    // matching breaks HERE rather than in the worker's wiring.
    const fits: PrismaService extends FiscalProfileReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("maps every stored profile column, one for one", async () => {
    const client = new ScopedClient();
    const result = await createFiscalProfileReader(client).readProfile(TENANT_A);

    expect(result?.profile).toEqual({
      ruc: "80012345",
      checkDigit: "6",
      taxpayerType: 2,
      regimeCode: 8,
      legalName: "Veterinaria Sur S.A.",
      tradeName: "VetSur",
      responsibleIssuerType: 1,
      responsibleIssuerTypeName: "Cédula de identidad",
      responsibleIssuerId: "1234567",
      responsibleIssuerName: "Ana Pérez",
      responsibleIssuerRole: "Representante legal",
      transactionType: 1,
      taxType: 1,
      emissionType: 1,
    });
    // The row's identity and timestamps are not part of the stored shape.
    expect(Object.keys(result?.profile ?? {}).sort()).toEqual([
      "checkDigit",
      "emissionType",
      "legalName",
      "regimeCode",
      "responsibleIssuerId",
      "responsibleIssuerName",
      "responsibleIssuerRole",
      "responsibleIssuerType",
      "responsibleIssuerTypeName",
      "ruc",
      "taxType",
      "taxpayerType",
      "tradeName",
      "transactionType",
    ]);
  });

  it("carries the activities in their stored order and drops the position", async () => {
    const client = new ScopedClient();
    const result = await createFiscalProfileReader(client).readProfile(TENANT_A);

    expect(result?.activities).toEqual([
      { code: "G47111", description: "Venta al por menor" },
      { code: "M75000", description: "Actividades veterinarias" },
    ]);
    expect(client.findManyArgs[0]?.orderBy).toEqual({ position: "asc" });
  });

  it("answers the declared default issuance point beside the profile", async () => {
    const client = new ScopedClient();
    const result = await createFiscalProfileReader(client).readProfile(TENANT_A);

    // DEC-057 Q4: the three columns identify the authorisation together and are
    // answered beside the stored profile, not folded into it.
    expect(result).toMatchObject({
      defaultEstablishmentId: ESTABLISHMENT_ID,
      defaultExpeditionPoint: "001",
      defaultDocumentType: 1,
    });
    expect(result?.profile).not.toHaveProperty("defaultEstablishmentId");
  });

  it("answers null on all three when the tenant declared no issuance point", async () => {
    const client = new ScopedClient({
      ...PROFILE_ROW,
      defaultEstablishmentId: null,
      defaultExpeditionPoint: null,
      defaultDocumentType: null,
    });
    const result = await createFiscalProfileReader(client).readProfile(TENANT_A);

    // NULL is the one state "not declared": this read carries it through and
    // invents no default; resolving or refusing is the assembly's step.
    expect(result).toMatchObject({
      defaultEstablishmentId: null,
      defaultExpeditionPoint: null,
      defaultDocumentType: null,
    });
  });

  it("requires the default issuance columns at the client boundary", () => {
    // Compile-time: if one of the three ever becomes optional again, its type
    // here is `never` and this stops compiling. The live-PostgreSQL proof would
    // not catch the loosening — Prisma's row always carries the columns — so the
    // unit boundary is what holds it.
    const establishment: RequiredRowKey<"defaultEstablishmentId"> = "defaultEstablishmentId";
    const point: RequiredRowKey<"defaultExpeditionPoint"> = "defaultExpeditionPoint";
    const documentType: RequiredRowKey<"defaultDocumentType"> = "defaultDocumentType";

    expect([establishment, point, documentType]).toHaveLength(3);
  });

  it("scopes the profile and its activities to the tenant it was given", async () => {
    const client = new ScopedClient();
    await createFiscalProfileReader(client).readProfile(TENANT_A);

    expect(client.findUniqueArgs[0]?.where).toEqual({ tenantId: TENANT_A });
    expect(client.findManyArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      profileId: PROFILE_ROW.id,
    });
  });

  it("returns null for a tenant with no profile and never asks for activities", async () => {
    const client = new ScopedClient();
    const result = await createFiscalProfileReader(client).readProfile(TENANT_B);

    // Tenant B never receives tenant A's row: the tenant is in the query, not
    // in the adapter's context.
    expect(result).toBeNull();
    expect(client.findUniqueArgs[0]?.where).toEqual({ tenantId: TENANT_B });
    expect(client.findManyArgs).toEqual([]);
  });
});

describe("readEstablishment", () => {
  it("maps every stored establishment column, one for one", async () => {
    const client = new ScopedClient();
    const result = await createFiscalProfileReader(client).readEstablishment(
      TENANT_A,
      ESTABLISHMENT_ID
    );

    expect(result).toEqual({
      code: "001",
      addressLine: "Av. Mcal. López",
      houseNumber: 1234,
      addressComplement1: "Edificio Aurora",
      addressComplement2: "Piso 2",
      departmentCode: 1,
      districtCode: 7,
      districtName: "ASUNCION",
      cityCode: 7,
      cityName: "ASUNCION",
      phone: "021123456",
      email: "fiscal@vetsur.example",
      branchName: "Casa central",
    });
    // The row's identity and timestamps are not part of the stored shape.
    expect(Object.keys(result ?? {}).sort()).toEqual([
      "addressComplement1",
      "addressComplement2",
      "addressLine",
      "branchName",
      "cityCode",
      "cityName",
      "code",
      "departmentCode",
      "districtCode",
      "districtName",
      "email",
      "houseNumber",
      "phone",
    ]);
  });

  it("scopes the read to the tenant and the establishment id", async () => {
    const client = new ScopedClient();
    await createFiscalProfileReader(client).readEstablishment(TENANT_A, ESTABLISHMENT_ID);

    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      id: ESTABLISHMENT_ID,
    });
  });

  it("returns null for an establishment that is not the tenant's", async () => {
    const client = new ScopedClient();
    const result = await createFiscalProfileReader(client).readEstablishment(
      TENANT_B,
      ESTABLISHMENT_ID
    );

    expect(result).toBeNull();
    expect(client.findFirstArgs[0]?.where).toEqual({
      tenantId: TENANT_B,
      id: ESTABLISHMENT_ID,
    });
  });
});
