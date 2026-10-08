/**
 * FISC-011 WU-E — the operator-facing service.
 *
 * The service's whole content is the GATE ORDER and the transaction's contents,
 * so both are asserted: the entitlement before the permission, and one
 * transaction per write spanning the rows and the audit row.
 */

import { DomainError } from "@newsaas/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import type {
  FiscalProfileClient,
  FiscalProfileRepository,
  FiscalProfileWriteTx,
} from "./timbrado.repository.js";
import {
  FISCAL_ESTABLISHMENT_SAVED_ACTION,
  FISCAL_PROFILE_SAVED_ACTION,
  FISCAL_RANGE_CREATED_ACTION,
  FISCAL_RANGE_RETIRED_ACTION,
  FiscalProfileService,
} from "./timbrado.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "99999999-9999-4999-8999-999999999999";
const ESTABLISHMENT_ID = "22222222-2222-4222-8222-222222222222";
const RANGE_ID = "33333333-3333-4333-8333-333333333333";

/** A client whose delegates record their calls and answer canned rows. */
function buildClient(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { table: string; method: string; args: unknown }[] = [];
  const record =
    (table: string, answer: unknown) =>
    (args: unknown): Promise<unknown> => {
      calls.push({ table, method: "call", args });
      return Promise.resolve(typeof answer === "function" ? (answer as () => unknown)() : answer);
    };

  const profileRow = {
    id: "p1",
    tenantId: TENANT,
    ruc: "80012345",
    checkDigit: "6",
    taxpayerType: 2,
    regimeCode: 8,
    legalName: "Clínica Veterinaria del Sur S.A.",
    tradeName: null,
    responsibleIssuerType: null,
    responsibleIssuerTypeName: null,
    responsibleIssuerId: null,
    responsibleIssuerName: null,
    responsibleIssuerRole: null,
    transactionType: 1,
    taxType: 1,
    emissionType: 1,
    createdAt: new Date("2026-10-07T00:00:00Z"),
    updatedAt: new Date("2026-10-07T00:00:00Z"),
  };
  const establishmentRow = {
    id: ESTABLISHMENT_ID,
    tenantId: TENANT,
    code: "001",
    addressLine: "Av. Mcal. López",
    houseNumber: 1234,
    addressComplement1: null,
    addressComplement2: null,
    departmentCode: 1,
    districtCode: null,
    districtName: null,
    cityCode: 7,
    cityName: "ASUNCION",
    phone: "021123456",
    email: "fiscal@vetsur.example",
    branchName: null,
    createdAt: new Date("2026-10-07T00:00:00Z"),
    updatedAt: new Date("2026-10-07T00:00:00Z"),
  };
  const rangeRow = {
    id: RANGE_ID,
    tenantId: TENANT,
    establishmentId: ESTABLISHMENT_ID,
    expeditionPoint: "001",
    documentType: 1,
    series: null,
    timbradoNumber: "12345678",
    rangeFrom: 1,
    rangeTo: 9_999_999,
    validityStart: new Date("2019-09-01T00:00:00Z"),
    nextNumber: 42,
    seriesStartedAt: null,
    status: "ACTIVE" as const,
    createdAt: new Date("2026-10-07T00:00:00Z"),
    updatedAt: new Date("2026-10-07T00:00:00Z"),
  };

  const client = {
    fiscalEmitterProfile: {
      findUnique: record("fiscalEmitterProfile", { ...profileRow, activities: [] }),
      create: record("fiscalEmitterProfile", profileRow),
      update: record("fiscalEmitterProfile", profileRow),
    },
    fiscalEmitterActivity: {
      deleteMany: record("fiscalEmitterActivity", { count: 0 }),
      createMany: record("fiscalEmitterActivity", { count: 1 }),
    },
    fiscalEstablishment: {
      findMany: record("fiscalEstablishment", [establishmentRow]),
      findFirst: record("fiscalEstablishment", establishmentRow),
      create: record("fiscalEstablishment", establishmentRow),
      update: record("fiscalEstablishment", establishmentRow),
    },
    fiscalTimbradoRange: {
      findMany: record("fiscalTimbradoRange", [rangeRow]),
      findFirst: record("fiscalTimbradoRange", rangeRow),
      create: record("fiscalTimbradoRange", rangeRow),
      updateMany: record("fiscalTimbradoRange", { count: 1 }),
    },
    auditLog: { create: record("auditLog", {}) },
    // The transaction hands the same client back, which is what makes the
    // "one transaction per write" claim checkable: the audit call and the row
    // writes must be the same object.
    $transaction: async <T>(work: (tx: FiscalProfileWriteTx) => Promise<T>): Promise<T> =>
      work(client),
    ...overrides,
  } as unknown as FiscalProfileClient;

  return { client, calls };
}

/** The repository surface the service uses, as a plain object. */
function buildRepository(client: FiscalProfileClient) {
  const delegates = client as unknown as {
    fiscalEmitterProfile: { findUnique: (args: unknown) => Promise<unknown> };
    fiscalEstablishment: {
      findMany: (args: unknown) => Promise<unknown>;
      findFirst: (args: unknown) => Promise<unknown>;
      create: (args: unknown) => Promise<unknown>;
      update: (args: unknown) => Promise<unknown>;
    };
    fiscalTimbradoRange: {
      findMany: (args: unknown) => Promise<unknown>;
      findFirst: (args: unknown) => Promise<unknown>;
      create: (args: unknown) => Promise<unknown>;
      updateMany: (args: unknown) => Promise<{ count: number }>;
    };
    fiscalEmitterProfile$create: (args: unknown) => Promise<unknown>;
  };

  return {
    findProfile: () => delegates.fiscalEmitterProfile.findUnique({}),
    listEstablishments: () => delegates.fiscalEstablishment.findMany({}),
    findEstablishment: () => delegates.fiscalEstablishment.findFirst({}),
    listRanges: () => delegates.fiscalTimbradoRange.findMany({}),
    findRange: () => delegates.fiscalTimbradoRange.findFirst({}),
    createEstablishment: (data: unknown) => delegates.fiscalEstablishment.create({ data }),
    updateEstablishment: (id: string, data: unknown) =>
      delegates.fiscalEstablishment.update({ where: { id }, data }),
    createRange: (data: unknown) => delegates.fiscalTimbradoRange.create({ data }),
    retireRangeIfActive: () =>
      delegates.fiscalTimbradoRange.updateMany({}).then((result) => result.count),
    upsertProfile: () => delegates.fiscalEmitterProfile.findUnique({}),
  };
}

function buildService(
  client: FiscalProfileClient,
  overrides: {
    entitled?: boolean;
    permissions?: string[];
    audit?: { append: ReturnType<typeof vi.fn> };
    materials?: readonly { certificatePem: string; certificateSubject: string }[];
  } = {}
) {
  const audit = overrides.audit ?? { append: vi.fn().mockResolvedValue({}) };
  const service = new FiscalProfileService(
    client,
    buildRepository(client) as unknown as FiscalProfileRepository,
    {
      requireTenantId: () => TENANT,
      requireUserProfileId: () => ACTOR,
    } as never,
    audit as never,
    { has: () => Promise.resolve(overrides.entitled ?? true) } as never,
    {
      resolveForActiveRequest: () =>
        Promise.resolve(new Set(overrides.permissions ?? [FISCAL_PERMISSIONS.profileManage])),
    } as never,
    // FISC-011 WU-G: the write path reads the tenant's ACTIVE certificates, and
    // each case chooses what they carry. A case that omits them has none.
    { listActive: () => Promise.resolve(overrides.materials ?? []) } as never
  );
  return { service, audit };
}

const PROFILE_INPUT = {
  ruc: "80012345",
  checkDigit: "6",
  taxpayerType: 2,
  regimeCode: 8,
  legalName: "Clínica Veterinaria del Sur S.A.",
  tradeName: null,
  responsibleIssuerType: null,
  responsibleIssuerTypeName: null,
  responsibleIssuerId: null,
  responsibleIssuerName: null,
  responsibleIssuerRole: null,
  transactionType: 1,
  taxType: 1,
  emissionType: 1,
  activities: [{ code: "47730", description: "Venta al por menor" }],
} as const;

describe("the gate order", () => {
  it("checks the fiscal entitlement before the permission", async () => {
    const { client } = buildClient();
    const { service } = buildService(client, { entitled: false });
    await expect(service.getProfile()).rejects.toThrow(DomainError);
    await expect(service.getProfile()).rejects.toThrow(/not enabled for this tenant/);
  });

  it("refuses a caller without fiscal.profile.manage", async () => {
    const { client } = buildClient();
    const { service } = buildService(client, { permissions: [] });
    await expect(service.getProfile()).rejects.toThrow(/permission is missing/);
  });

  it("refuses every write the same way, before touching a row", async () => {
    const { client, calls } = buildClient();
    const { service } = buildService(client, { permissions: [] });
    await expect(service.saveProfile(PROFILE_INPUT)).rejects.toThrow(/permission is missing/);
    await expect(service.createEstablishment({ ...ESTABLISHMENT_INPUT })).rejects.toThrow(
      /permission is missing/
    );
    await expect(service.createRange(RANGE_INPUT)).rejects.toThrow(/permission is missing/);
    expect(calls).toEqual([]);
  });
});

describe("every write is one transaction spanning the row and the audit row", () => {
  it("saves the profile and audits field NAMES, never their values", async () => {
    const { client } = buildClient();
    const { service, audit } = buildService(client);
    await service.saveProfile(PROFILE_INPUT);

    expect(audit.append).toHaveBeenCalledTimes(1);
    const [input, tx] = audit.append.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(input.action).toBe(FISCAL_PROFILE_SAVED_ACTION);
    expect(input.tenantId).toBe(TENANT);
    expect(input.targetType).toBe("fiscal_emitter_profile");
    // The metadata carries the field NAMES and the activity count. A profile has
    // a RUC and an address, and the audit row is not the place for either.
    const metadata = input.metadata as {
      schemaVersion: number;
      fields: string[];
      activityCount: number;
    };
    expect(metadata.schemaVersion).toBe(1);
    expect(metadata.activityCount).toBe(1);
    expect(metadata.fields).toEqual(expect.arrayContaining(["ruc", "legalName", "taxType"]));
    expect(JSON.stringify(metadata)).not.toContain("80012345");
    // The audit call and the row write share the transaction handle.
    expect(tx).toBe(client);
  });

  it("creates an establishment and audits it", async () => {
    const { client } = buildClient();
    const { service, audit } = buildService(client);
    const view = await service.createEstablishment(ESTABLISHMENT_INPUT);

    expect(view.id).toBe(ESTABLISHMENT_ID);
    expect(audit.append.mock.calls[0]?.[0]).toMatchObject({
      action: FISCAL_ESTABLISHMENT_SAVED_ACTION,
      targetId: ESTABLISHMENT_ID,
      metadata: { schemaVersion: 1, code: "001", created: true },
    });
  });

  it("creates a range with nothing consumed and no series start", async () => {
    const { client, calls } = buildClient();
    const { service, audit } = buildService(client);
    await service.createRange(RANGE_INPUT);

    const created = calls.find(
      (call) => call.table === "fiscalTimbradoRange" && call.method === "call"
    )?.args as { data: Record<string, unknown> } | undefined;
    expect(created?.data).toMatchObject({
      nextNumber: RANGE_INPUT.rangeFrom,
      // The Manual puts a series' start at the first DE's signature date.
      seriesStartedAt: null,
      status: "ACTIVE",
    });
    expect(audit.append.mock.calls[0]?.[0]).toMatchObject({
      action: FISCAL_RANGE_CREATED_ACTION,
      metadata: { timbradoNumber: "12345678", series: null },
    });
  });

  it("retires a range that is still active, and audits how much it consumed", async () => {
    const { client } = buildClient();
    const { service, audit } = buildService(client);
    const view = await service.retireRange(RANGE_ID, "replaced by a new authorisation");

    expect(view.status).toBe("RETIRED");
    expect(audit.append.mock.calls[0]?.[0]).toMatchObject({
      action: FISCAL_RANGE_RETIRED_ACTION,
      metadata: { reason: "replaced by a new authorisation", consumed: 41 },
    });
  });
});

describe("a resource outside the tenant is not found, not forbidden", () => {
  it("answers NOT_FOUND for an establishment the tenant does not own", async () => {
    const { client } = buildClient({
      fiscalEstablishment: {
        findFirst: () => Promise.resolve(null),
        findMany: () => Promise.resolve([]),
        create: () => Promise.resolve(null),
        update: () => Promise.resolve(null),
      },
    });
    const { service } = buildService(client);
    await expect(
      service.updateEstablishment(ESTABLISHMENT_ID, ESTABLISHMENT_INPUT)
    ).rejects.toThrow(/establishment was not found/);
  });

  it("answers NOT_FOUND for a range the tenant does not own", async () => {
    const { client } = buildClient({
      fiscalTimbradoRange: {
        findFirst: () => Promise.resolve(null),
        findMany: () => Promise.resolve([]),
        create: () => Promise.resolve(null),
        updateMany: () => Promise.resolve({ count: 0 }),
      },
    });
    const { service } = buildService(client);
    await expect(service.retireRange(RANGE_ID, "reason")).rejects.toThrow(
      /timbrado range was not found/
    );
  });

  it("refuses a range whose establishment is in another tenant", async () => {
    // The composite foreign key makes this unrepresentable in the database; the
    // service refuses it before the insert rather than surfacing a constraint.
    const { client } = buildClient({
      fiscalEstablishment: {
        findFirst: () => Promise.resolve(null),
        findMany: () => Promise.resolve([]),
        create: () => Promise.resolve(null),
        update: () => Promise.resolve(null),
      },
    });
    const { service } = buildService(client);
    await expect(service.createRange(RANGE_INPUT)).rejects.toThrow(/establishment was not found/);
  });
});

describe("retiring a range that is not active is a conflict, not a success", () => {
  it("refuses when the compare-and-swap found nothing to retire", async () => {
    const { client } = buildClient({
      fiscalTimbradoRange: {
        findFirst: () =>
          Promise.resolve({
            id: RANGE_ID,
            tenantId: TENANT,
            establishmentId: ESTABLISHMENT_ID,
            expeditionPoint: "001",
            documentType: 1,
            series: null,
            timbradoNumber: "12345678",
            rangeFrom: 1,
            rangeTo: 9_999_999,
            validityStart: new Date("2019-09-01T00:00:00Z"),
            nextNumber: 42,
            seriesStartedAt: null,
            status: "EXHAUSTED" as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        findMany: () => Promise.resolve([]),
        create: () => Promise.resolve(null),
        updateMany: () => Promise.resolve({ count: 0 }),
      },
    });
    const { service, audit } = buildService(client);
    await expect(service.retireRange(RANGE_ID, "reason")).rejects.toThrow(
      /timbrado range is not active/
    );
    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe("the reads", () => {
  let client: FiscalProfileClient;
  beforeEach(() => {
    client = buildClient().client;
  });

  it("returns the profile with its activities in stored order", async () => {
    const { service } = buildService(client);
    const view = await service.getProfile();
    expect(view.ruc).toBe("80012345");
    expect(view.activities).toEqual([]);
  });

  it("answers NOT_FOUND when the tenant has no profile yet", async () => {
    const { client: empty } = buildClient({
      fiscalEmitterProfile: {
        findUnique: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
        update: () => Promise.resolve(null),
      },
    });
    const { service } = buildService(empty);
    await expect(service.getProfile()).rejects.toThrow(/profile was not found/);
  });

  it("lists establishments and ranges", async () => {
    const { service } = buildService(client);
    expect((await service.listEstablishments())[0]?.code).toBe("001");
    expect((await service.listRanges())[0]?.timbradoNumber).toBe("12345678");
  });
});

const ESTABLISHMENT_INPUT = {
  code: "001",
  addressLine: "Av. Mcal. López",
  houseNumber: 1234,
  addressComplement1: null,
  addressComplement2: null,
  departmentCode: 1,
  districtCode: null,
  districtName: null,
  cityCode: 7,
  cityName: "ASUNCION",
  phone: "021123456",
  email: "fiscal@vetsur.example",
  branchName: null,
} as const;

const RANGE_INPUT = {
  establishmentId: ESTABLISHMENT_ID,
  expeditionPoint: "001",
  documentType: 1,
  series: null,
  timbradoNumber: "12345678",
  rangeFrom: 1,
  rangeTo: 9_999_999,
  validityStart: new Date("2019-09-01T00:00:00Z"),
} as const;

describe("the RUC obligation (baseline §22.4, D101)", () => {
  /** A subject that carries the RUC where SIFEN pins it for a legal person. */
  const PINNED_SUBJECT = "C=PY\nO=Clínica Veterinaria del Sur S.A.\nserialNumber=RUC80012345-6";

  it("refuses a profile whose RUC is not the one the certificate carries", async () => {
    const { client } = buildClient();
    const { service } = buildService(client, {
      materials: [
        {
          // A legal person's RUC comes from the subject, so the PEM is never
          // consulted and a placeholder cannot weaken the case.
          certificatePem: "not-read-for-a-legal-person",
          certificateSubject: "C=PY\nserialNumber=RUC80099999-6",
        },
      ],
    });

    await expect(service.saveProfile(PROFILE_INPUT)).rejects.toThrow(DomainError);
    await expect(service.saveProfile(PROFILE_INPUT)).rejects.toThrow(
      /does not match the RUC in the tenant's signing certificate/
    );
  });

  it("refuses a certificate that carries no RUC where SIFEN expects it", async () => {
    const { client } = buildClient();
    const { service } = buildService(client, {
      materials: [
        {
          certificatePem: "not-read-for-a-legal-person",
          // The test fixture's own shape: the RUC sits in the `CN`, which is not
          // the pinned placement, so there is nothing to compare against and the
          // profile write must not proceed as if there were.
          certificateSubject: "C=PY\nO=Clínica Veterinaria del Sur S.A.\nCN=RUC80012345-6",
        },
      ],
    });

    await expect(service.saveProfile(PROFILE_INPUT)).rejects.toThrow(
      /does not carry the RUC where SIFEN requires it/
    );
  });

  it("proceeds when the certificate carries the same RUC", async () => {
    const { client } = buildClient();
    const { service } = buildService(client, {
      materials: [
        { certificatePem: "not-read-for-a-legal-person", certificateSubject: PINNED_SUBJECT },
      ],
    });

    await expect(service.saveProfile(PROFILE_INPUT)).resolves.toMatchObject({ ruc: "80012345" });
  });

  it("proceeds when the tenant has no ACTIVE certificate yet", async () => {
    // Nothing to compare means the profile write is the side that proceeds, and
    // the upload that follows is the side that refuses — which is why the
    // obligation is enforced on both writes rather than on one.
    const { client } = buildClient();
    const { service } = buildService(client);

    await expect(service.saveProfile(PROFILE_INPUT)).resolves.toMatchObject({ ruc: "80012345" });
  });
});
