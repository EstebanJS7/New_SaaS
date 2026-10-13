/**
 * FISC-011 WU-E — the operator-facing service.
 *
 * The service's whole content is the GATE ORDER and the transaction's contents,
 * so both are asserted: the entitlement before the permission, and one
 * transaction per write spanning the rows and the audit row.
 */

import { DomainError } from "@newsaas/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_SIGNATURE_PLACEHOLDER,
  SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE,
  serializeEventReception,
  type FiscalCredentialPort,
  type FiscalProviderPort,
  type FiscalRangeVoidRequest,
  type FiscalRangeVoidResult,
  type FiscalTransportCredential,
} from "@newsaas/fiscal";
import { FIXTURE_CERTIFICATE_PEM, FIXTURE_PRIVATE_KEY_PEM } from "@newsaas/fiscal/testing";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import type {
  FiscalProfileClient,
  FiscalProfileRepository,
  FiscalProfileWriteTx,
  FiscalRangeVoidWriteRow,
  RecordRangeVoidInput,
  TimbradoRangeRow,
} from "./timbrado.repository.js";
import {
  assertRangeVoidable,
  buildInutilizacionEventDocument,
  FISCAL_ESTABLISHMENT_SAVED_ACTION,
  FISCAL_PROFILE_SAVED_ACTION,
  FISCAL_RANGE_CREATED_ACTION,
  FISCAL_RANGE_RETIRED_ACTION,
  FISCAL_RANGE_VOIDED_ACTION,
  FISCAL_RANGE_VOID_CHANGED_MESSAGE,
  FISCAL_RANGE_VOID_CLAIM_LEASE_MS,
  FISCAL_RANGE_VOID_DOCUMENT_TYPE_MESSAGE,
  FISCAL_RANGE_VOID_EVENT_ID,
  FISCAL_RANGE_VOID_EXHAUSTED_MESSAGE,
  FISCAL_RANGE_VOID_FAILED_ACTION,
  FISCAL_RANGE_VOID_IN_FLIGHT_MESSAGE,
  FISCAL_RANGE_VOID_NO_CLAIM_MESSAGE,
  FISCAL_RANGE_VOID_REASON_MESSAGE,
  FISCAL_RANGE_VOID_RETIRED_MESSAGE,
  FISCAL_RANGE_VOID_TIMEOUT_MS,
  FISCAL_RANGE_VOID_TIMEOUT_REASON,
  isRangeVoidClaimStale,
  mapFiscalRangeVoidOutcome,
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
    { listActive: () => Promise.resolve(overrides.materials ?? []) } as never,
    // FISC-016 WU-D: this surface's only provider-facing operation is the void,
    // and the cases that drive it build their own harness below.
    {
      provider: "FAKE",
      requiresSignedDocument: false,
      issue: () => Promise.reject(new Error("issue is not under test")),
      query: () => Promise.reject(new Error("query is not under test")),
      cancel: () => Promise.reject(new Error("cancel is not under test")),
      voidRange: () => Promise.reject(new Error("voidRange is not under test")),
    },
    {
      // The base harness never reads a credential: only the void's own harness
      // does, and it records the reads.
      read: () => Promise.reject(new Error("no credential read is expected here")),
    },
    FISCAL_SIGNING_ENVIRONMENT_VALUE
  );
  return { service, audit };
}

/** The environment the tests' signing reads name; the value is arbitrary here. */
const FISCAL_SIGNING_ENVIRONMENT_VALUE = "TEST" as const;

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

/**
 * FISC-016 WU-D — the range void's business surface.
 *
 * The operation is a fiscal submission of its own, so what these cases pin is
 * everything the schema does not (§25.7): the interval is the range's REMAINING
 * TAIL and the caller never names it, every state that makes a void a lie is
 * refused BY NAME before a provider is asked, the provider call happens outside
 * any transaction, and the flip and the record are one transaction.
 */
const VOID_REASON = "We stopped using this authorisation";
const CREDENTIAL: FiscalTransportCredential = {
  certificatePem: FIXTURE_CERTIFICATE_PEM,
  privateKeyPem: FIXTURE_PRIVATE_KEY_PEM,
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2027-01-01T00:00:00.000Z"),
};

/** A range whose tail is `nextNumber .. rangeTo`, as the void's interval. */
function voidableRange(overrides: Partial<TimbradoRangeRow> = {}): TimbradoRangeRow {
  return {
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
    status: "ACTIVE",
    createdAt: new Date("2026-10-07T00:00:00Z"),
    updatedAt: new Date("2026-10-07T00:00:00Z"),
    ...overrides,
  };
}

function voidResult(overrides: Partial<FiscalRangeVoidResult> = {}): FiscalRangeVoidResult {
  return {
    outcome: "VOIDED",
    providerReference: "1234567890",
    reasonCode: "0300",
    reason: "Evento aceptado",
    retryAfterMs: null,
    providerRequest: { provider: "SIFEN_DIRECT", service: "receiveEvent", cdc: null },
    providerResponse: { provider: "SIFEN_DIRECT", service: "receiveEvent", statusCode: "Aprobado" },
    resolvedAt: "2026-10-11T12:00:00.000Z",
    ...overrides,
  };
}

/**
 * The open claim a VOIDING range carries: `IN_FLIGHT` by default, with a lease
 * already older than the window, because the adoption cases pin the re-drive;
 * the in-flight refusal's case supplies a fresh lease instead.
 */
function openClaimRow(
  builtAt: number,
  overrides: Partial<FiscalRangeVoidWriteRow> = {}
): FiscalRangeVoidWriteRow {
  return {
    id: "void-0",
    tenantId: TENANT,
    rangeId: RANGE_ID,
    fromNumber: 42,
    toNumber: 9_999_999,
    reason: VOID_REASON,
    outcome: "IN_FLIGHT",
    attempt: 1,
    reasonCode: null,
    providerReason: null,
    providerReference: null,
    rangeStatus: "VOIDING",
    claimedAt: new Date(builtAt - FISCAL_RANGE_VOID_CLAIM_LEASE_MS - 1_000),
    createdAt: new Date(builtAt - 3_600_000),
    ...overrides,
  };
}

interface VoidHarness {
  readonly service: FiscalProfileService;
  readonly requests: FiscalRangeVoidRequest[];
  readonly credentialReads: { readonly tenantId: string; readonly environment: string }[];
  /** The claim rows the void wrote, with the interval it claimed. */
  readonly recorded: Record<string, unknown>[];
  /** The settlements that closed a claim, in order. */
  readonly settled: Record<string, unknown>[];
  readonly audit: { append: ReturnType<typeof vi.fn> };
  /** How many times the VOIDING -> RETIRED|ACTIVE compare-and-swap ran. */
  readonly settleCalls: () => number;
  readonly claimCalls: () => number;
  readonly rangeStatus: () => TimbradoRangeRow["status"];
  /** The rows the range read answered with, in order. */
  readonly reads: TimbradoRangeRow[];
  /** The open claim's row, or null once it was settled. */
  readonly openClaim: () => FiscalRangeVoidWriteRow | null;
  /** Every claim write, submission and settlement, in the order it ran. */
  readonly order: string[];
  readonly gateReached: Promise<void>;
  readonly releaseGate: () => void;
}

/**
 * A `FiscalProfileService` wired just richly enough to exercise the void end to
 * end: the range read, the claim, the settlement, the record, the audit and the
 * provider all record what the operation did and in which order.
 */
function buildVoidHarness(
  options: {
    readonly range?: TimbradoRangeRow;
    /** The claim CAS finds the range moved, retired or already claimed. */
    readonly claimFails?: boolean;
    /** The range's settlement CAS finds the claim gone after the provider answered. */
    readonly settleRangeFails?: boolean;
    readonly settleRecordFails?: boolean;
    /** The open claim a VOIDING range is re-driven from; `null` is the inconsistency. */
    readonly pendingClaim?: Partial<FiscalRangeVoidWriteRow> | null;
    readonly result?: FiscalRangeVoidResult;
    readonly requiresDocument?: boolean;
    readonly credential?: FiscalTransportCredential | null;
    readonly permissions?: readonly string[];
    readonly entitled?: boolean;
    readonly hangs?: boolean;
    readonly holdAdoption?: boolean;
    readonly holdProvider?: boolean;
    readonly missingRange?: boolean;
    readonly missingEstablishment?: boolean;
  } = {}
): VoidHarness {
  const reads: TimbradoRangeRow[] = [];
  const requests: FiscalRangeVoidRequest[] = [];
  const credentialReads: { tenantId: string; environment: string }[] = [];
  const recorded: Record<string, unknown>[] = [];
  const settled: Record<string, unknown>[] = [];
  const order: string[] = [];
  let settleCalls = 0;
  let claimCalls = 0;
  let rangeStatus: TimbradoRangeRow["status"] = (options.range ?? voidableRange()).status;
  const audit = { append: vi.fn().mockResolvedValue({}) };
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => (releaseGate = resolve));
  let markGateReached!: () => void;
  const gateReached = new Promise<void>((resolve) => (markGateReached = resolve));
  let adoptCalls = 0;
  const builtAt = Date.now();
  let openClaim: FiscalRangeVoidWriteRow | null = options.pendingClaim
    ? openClaimRow(builtAt, options.pendingClaim)
    : null;

  const findRange = (): Promise<TimbradoRangeRow | null> => {
    const answer = { ...(options.range ?? voidableRange()), status: rangeStatus };
    reads.push(answer);
    if (options.missingRange === true) return Promise.resolve(null);
    return Promise.resolve(answer);
  };

  const repository = {
    findRange,
    findEstablishment: () =>
      Promise.resolve(
        options.missingEstablishment === true
          ? null
          : { id: ESTABLISHMENT_ID, tenantId: TENANT, code: "001" }
      ),
    findOpenRangeVoid: () => Promise.resolve(openClaim === null ? null : { ...openClaim }),
    claimRangeVoid: () => {
      order.push("claim");
      claimCalls += 1;
      if (options.claimFails === true) return Promise.resolve(0);
      rangeStatus = "VOIDING";
      return Promise.resolve(1);
    },
    adoptRangeVoid: async (
      _id: string,
      expectedAttempt: number,
      staleBefore: Date,
      claimedAt: Date
    ) => {
      order.push("adopt");
      if (options.holdAdoption === true && adoptCalls++ === 0) {
        markGateReached();
        await gate;
      }
      // The fake models the database's predicate: even if the pre-check saw a
      // stale lease, only a STALE claim with the observed attempt matches.
      if (
        openClaim?.outcome !== "IN_FLIGHT" ||
        openClaim.attempt !== expectedAttempt ||
        openClaim.claimedAt === null ||
        openClaim.claimedAt.getTime() > staleBefore.getTime()
      ) {
        return 0;
      }
      openClaim = { ...openClaim, attempt: expectedAttempt + 1, claimedAt };
      return 1;
    },
    markRangeVoidInFlight: (id: string, expectedAttempt: number, claimedAt: Date) => {
      order.push("mark");
      if (
        openClaim?.id !== id ||
        openClaim.outcome !== "PENDING" ||
        openClaim.attempt !== expectedAttempt
      ) {
        return Promise.resolve(0);
      }
      openClaim = { ...openClaim, outcome: "IN_FLIGHT", claimedAt };
      return Promise.resolve(1);
    },
    settleRangeVoid: (
      _id: string,
      _next: number,
      expectedAttempt: number,
      status: "ACTIVE" | "RETIRED"
    ) => {
      order.push("settle-range");
      settleCalls += 1;
      if (options.settleRangeFails === true) return Promise.resolve(0);
      if (expectedAttempt !== openClaim?.attempt) return Promise.resolve(0);
      rangeStatus = status;
      return Promise.resolve(1);
    },
    recordRangeVoid: (input: RecordRangeVoidInput) => {
      order.push("record");
      recorded.push(input);
      const row: FiscalRangeVoidWriteRow = {
        id: "void-1",
        tenantId: TENANT,
        rangeId: RANGE_ID,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        reason: input.reason,
        outcome: input.outcome,
        attempt: input.attempt,
        claimedAt: input.claimedAt,
        reasonCode: input.reasonCode,
        providerReason: input.providerReason,
        providerReference: input.providerReference,
        rangeStatus: input.rangeStatus,
        createdAt: new Date(),
      };
      openClaim = row;
      return Promise.resolve(row);
    },
    settleRangeVoidRecord: (input: Record<string, unknown>) => {
      order.push("settle-record");
      if (options.settleRecordFails === true) return Promise.resolve(0);
      if (
        openClaim?.outcome !== "IN_FLIGHT" ||
        input.id !== openClaim.id ||
        input.attempt !== openClaim.attempt
      ) {
        return Promise.resolve(0);
      }
      openClaim = null;
      settled.push(input);
      return Promise.resolve(1);
    },
  } as unknown as FiscalProfileRepository;

  const prisma = {
    // A transaction fake that ROLLS BACK: the range's status, the claim's state
    // and the settlement log are restored when the callback throws, so a
    // committed half is visible.
    $transaction: async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      const before = rangeStatus;
      const settledLength = settled.length;
      const openBefore = openClaim;
      const orderLength = order.length;
      try {
        return await work({});
      } catch (error) {
        rangeStatus = before;
        settled.length = settledLength;
        openClaim = openBefore;
        order.length = orderLength;
        throw error;
      }
    },
  } as never;

  const provider = {
    provider: "SIFEN_DIRECT",
    requiresSignedDocument: options.requiresDocument ?? false,
    issue: () => Promise.reject(new Error("issue is not under test")),
    query: () => Promise.reject(new Error("query is not under test")),
    cancel: () => Promise.reject(new Error("cancel is not under test")),
    voidRange: async (request: FiscalRangeVoidRequest): Promise<FiscalRangeVoidResult> => {
      requests.push(request);
      order.push("provider");
      // `hangs` never answers the FIRST submission, so a case can prove what a
      // later adoption does once the first attempt's deadline passed.
      if (options.hangs === true && requests.length === 1) {
        return new Promise<FiscalRangeVoidResult>(() => undefined);
      }
      if (options.holdProvider === true && requests.length === 1) {
        markGateReached();
        await gate;
      }
      // ADR-009 §3, the rule every real adapter follows: a requiring provider
      // handed no document answers CONFIGURATION_ERROR and submits nothing.
      if ((options.requiresDocument ?? false) && request.document === null) {
        return Promise.resolve(
          voidResult({
            outcome: "CONFIGURATION_ERROR",
            reasonCode: SIFEN_DIRECT_DOCUMENT_REQUIRED_REASON_CODE,
            reason: "The SIFEN_DIRECT provider submits a signed document.",
            providerReference: null,
          })
        );
      }
      return Promise.resolve(options.result ?? voidResult());
    },
  } as FiscalProviderPort;

  const credentialPort = {
    read: (args: { tenantId: string; environment: string }) => {
      credentialReads.push(args);
      return Promise.resolve(options.credential === undefined ? CREDENTIAL : options.credential);
    },
  } as unknown as FiscalCredentialPort;

  const service = new FiscalProfileService(
    prisma as FiscalProfileClient,
    repository,
    {
      requireTenantId: () => TENANT,
      requireUserProfileId: () => ACTOR,
    } as never,
    audit as never,
    { has: () => Promise.resolve(options.entitled ?? true) } as never,
    {
      resolveForActiveRequest: () =>
        Promise.resolve(new Set(options.permissions ?? [FISCAL_PERMISSIONS.rangeVoid])),
    } as never,
    { listActive: () => Promise.resolve([]) } as never,
    provider,
    credentialPort,
    "TEST"
  );

  return {
    service,
    requests,
    credentialReads,
    recorded,
    settled,
    audit,
    settleCalls: () => settleCalls,
    claimCalls: () => claimCalls,
    rangeStatus: () => rangeStatus,
    reads,
    openClaim: () => openClaim,
    order,
    gateReached,
    releaseGate,
  };
}

describe("FiscalProfileService.voidRange — the refusals, by name", () => {
  it("refuses without the fiscal entitlement, before any read", async () => {
    const harness = buildVoidHarness({ entitled: false });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "FEATURE_NOT_ENTITLED",
    });
    expect(harness.reads).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
  });

  it("refuses a caller without fiscal.range.void, and does not accept profile.manage in its place", async () => {
    const harness = buildVoidHarness({ permissions: [FISCAL_PERMISSIONS.profileManage] });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(harness.reads).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
  });

  it("answers 404 for a range that does not exist, and for another tenant's range", async () => {
    // Both are the same answer on purpose: the read is tenant-scoped, so a
    // foreign id can only ever find nothing, and a 403 would confirm the row
    // exists somewhere else.
    const missing = buildVoidHarness({ missingRange: true });
    await expect(missing.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "The timbrado range was not found.",
    });
    expect(missing.requests).toHaveLength(0);

    const foreign = buildVoidHarness({ missingRange: true });
    await expect(foreign.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toThrow(
      /timbrado range was not found/
    );
  });

  it("refuses an already RETIRED range by name", async () => {
    const harness = buildVoidHarness({ range: voidableRange({ status: "RETIRED" }) });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_RETIRED_MESSAGE,
    });
    expect(harness.requests).toHaveLength(0);
    expect(harness.recorded).toHaveLength(0);
  });

  it("refuses an EXHAUSTED range by name, because its tail is empty", async () => {
    const harness = buildVoidHarness({
      range: voidableRange({ status: "EXHAUSTED", nextNumber: 10_000_000 }),
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_EXHAUSTED_MESSAGE,
    });
    expect(harness.requests).toHaveLength(0);
  });

  it("refuses an ACTIVE range whose counter is one past its end, which is the same empty tail", async () => {
    // §13: the claim that takes the LAST number increments the counter one past
    // the end while the status is still ACTIVE, so "no tail" is not the same
    // question as "which status does the column say".
    const harness = buildVoidHarness({
      range: voidableRange({ nextNumber: 10_000_000 }),
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_EXHAUSTED_MESSAGE,
    });
    expect(harness.requests).toHaveLength(0);
  });

  it("refuses a range whose document type the event cannot express (10 is DE-legal, event-illegal)", async () => {
    // `tiTiDE` admits 10 and `tiTiDEEv` stops at 9 (§25.2), so this range exists
    // and cannot be voided: sending it would produce a document that validates
    // against nothing.
    const harness = buildVoidHarness({ range: voidableRange({ documentType: 10 }) });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_DOCUMENT_TYPE_MESSAGE,
    });
    expect(harness.requests).toHaveLength(0);
  });

  it("refuses a reason outside mOtEve's domain, for a provider that requires no document too", async () => {
    // The reason travels to the record's own column as well as to the event, so
    // the rule holds whether or not a builder ever sees it.
    for (const reason of ["no", "x".repeat(501)]) {
      const harness = buildVoidHarness({ requiresDocument: false });
      await expect(harness.service.voidRange(RANGE_ID, reason)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        message: FISCAL_RANGE_VOID_REASON_MESSAGE,
      });
      expect(harness.requests).toHaveLength(0);
      expect(harness.recorded).toHaveLength(0);
    }
  });
});

describe("FiscalProfileService.voidRange — the interval and the record", () => {
  it("voids the REMAINING TAIL the caller never named, and flips the range with the record", async () => {
    const harness = buildVoidHarness({ range: voidableRange({ nextNumber: 42 }) });

    const view = await harness.service.voidRange(RANGE_ID, VOID_REASON);

    // The provider is told the tail, from the counter to the authorised end.
    expect(harness.requests).toHaveLength(1);
    const request = harness.requests[0];
    expect(request?.from).toBe(42);
    expect(request?.to).toBe(9_999_999);
    expect(request?.reason).toBe(VOID_REASON);
    expect(request?.tenantId).toBe(TENANT);
    expect(request?.provider).toBe("SIFEN_DIRECT");
    // A provider that declares `requiresSignedDocument` false is handed null,
    // exactly as the cancellation's rule says, and no credential is read.
    expect(request?.document).toBeNull();
    expect(harness.credentialReads).toHaveLength(0);

    // The claim is written PENDING, enters IN_FLIGHT before the call, and the
    // settlement closes it with the provider's answer.
    expect(harness.recorded).toHaveLength(1);
    const claim = harness.recorded[0];
    expect(claim.rangeId).toBe(RANGE_ID);
    expect(claim.fromNumber).toBe(42);
    expect(claim.toNumber).toBe(9_999_999);
    expect(claim.reason).toBe(VOID_REASON);
    expect(claim.outcome).toBe("PENDING");
    expect(claim.claimedAt).toBeNull();
    expect(claim.rangeStatus).toBe("VOIDING");
    // The flip to IN_FLIGHT lands before the provider is asked, so a second
    // arrival during the call meets a claim in flight and not a plan.
    expect(harness.order).toEqual([
      "claim",
      "record",
      "mark",
      "provider",
      "settle-range",
      "settle-record",
    ]);

    const settled = harness.settled[0];
    expect(settled.outcome).toBe("VOIDED");
    expect(settled.reasonCode).toBe("0300");
    expect(settled.providerReason).toBe("Evento aceptado");
    expect(settled.providerReference).toBe("1234567890");
    expect(settled.rangeStatus).toBe("RETIRED");

    // The settlement runs once, and only for an accepted void.
    expect(harness.settleCalls()).toBe(1);

    expect(view.outcome).toBe("VOIDED");
    expect(view.rangeStatus).toBe("RETIRED");
    expect(view.providerReference).toBe("1234567890");
    expect(view.createdAt).toBeInstanceOf(Date);
  });

  it("audits the void with the interval and the outcome, and never the free text", async () => {
    const harness = buildVoidHarness();

    await harness.service.voidRange(RANGE_ID, VOID_REASON);

    expect(harness.audit.append).toHaveBeenCalledTimes(1);
    const [input, tx] = harness.audit.append.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(input.action).toBe(FISCAL_RANGE_VOIDED_ACTION);
    expect(input.tenantId).toBe(TENANT);
    expect(input.actorUserProfileId).toBe(ACTOR);
    expect(input.targetType).toBe("fiscal_timbrado_range");
    expect(input.targetId).toBe(RANGE_ID);
    expect(input.metadata).toMatchObject({
      outcome: "VOIDED",
      fromNumber: 42,
      toNumber: 9_999_999,
      rangeStatus: "RETIRED",
      voidId: "void-1",
    });
    expect(JSON.stringify(input.metadata)).not.toContain(VOID_REASON);
    // The audit row and the record travel in the same transaction handle.
    expect(tx).toBeDefined();
  });

  it("refuses the claim when the counter moved or another void claimed it, with no provider call", async () => {
    // Both shapes are one CAS: the range moved (an issuance burned numbers), was
    // retired, or is already VOIDING. A second concurrent void lands here too, so
    // the provider is never asked twice.
    for (const shape of ["the counter moved", "a second concurrent void"]) {
      const harness = buildVoidHarness({ claimFails: true });

      await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
        code: "CONFLICT",
        message: FISCAL_RANGE_VOID_CHANGED_MESSAGE,
      });

      expect(harness.requests, shape).toHaveLength(0);
      expect(harness.recorded, shape).toHaveLength(0);
      expect(harness.audit.append, shape).not.toHaveBeenCalled();
    }
  });
});

describe("FiscalProfileService.voidRange — the VOIDING range a fresh call re-drives", () => {
  it("adopts the STALE in-flight claim and re-submits the RECORDED interval, never a fresh tail", async () => {
    const harness = buildVoidHarness({
      // The counter is frozen while VOIDING, so the record and the row agree in
      // production; the differing counter pins which source the re-drive reads.
      range: voidableRange({ status: "VOIDING", nextNumber: 50 }),
      // The default claim's lease is already older than the window, so this
      // call is the one that may adopt it.
      pendingClaim: { fromNumber: 42, toNumber: 9_999_999 },
      requiresDocument: true,
    });

    const view = await harness.service.voidRange(RANGE_ID, VOID_REASON);

    expect(harness.claimCalls()).toBe(0);
    expect(harness.recorded).toHaveLength(0);
    // The provider and the signed event both carry the RECORDED interval.
    expect(harness.requests[0]?.from).toBe(42);
    expect(harness.requests[0]?.to).toBe(9_999_999);
    expect(harness.requests[0]?.document?.signedXml).toContain("<dNumIn>0000042</dNumIn>");
    // The adopted claim is settled exactly as the normal path settles its own.
    expect(harness.settled[0]?.id).toBe("void-0");
    expect(harness.settled[0]?.attempt).toBe(2);
    expect(harness.settled[0]?.rangeStatus).toBe("RETIRED");
    expect(view.outcome).toBe("VOIDED");
    expect(view.rangeStatus).toBe("RETIRED");
  });

  it("refuses a VOIDING range with no open claim by name, reading nothing from the provider", async () => {
    const harness = buildVoidHarness({
      range: voidableRange({ status: "VOIDING" }),
      requiresDocument: true,
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_NO_CLAIM_MESSAGE,
    });
    expect(harness.requests).toHaveLength(0);
    expect(harness.credentialReads).toHaveLength(0);
  });

  it("lets one of two concurrent re-drives adopt the claim, and refuses the other before the provider", async () => {
    const harness = buildVoidHarness({
      range: voidableRange({ status: "VOIDING" }),
      pendingClaim: {},
      holdAdoption: true,
    });

    // Both read the STALE claim at attempt 1; the first is parked at its CAS
    // while the second runs, so the second's adoption wins and the first's
    // fails. Only one submission leaves the building.
    const first = harness.service.voidRange(RANGE_ID, VOID_REASON);
    const firstSettled = first.then(
      () => "resolved",
      (error: unknown) => error
    );
    await harness.gateReached;
    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).resolves.toMatchObject({
      outcome: "VOIDED",
    });
    harness.releaseGate();

    await expect(firstSettled).resolves.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_CHANGED_MESSAGE,
    });
    // One submission left the building, settled on the adoption's attempt.
    expect(harness.requests).toHaveLength(1);
    expect(harness.settled[0]?.attempt).toBe(2);
  });

  it("refuses to settle an attempt a newer adoption replaced, so the newest attempt owns the outcome", async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-10-11T12:00:00.000Z");
      vi.setSystemTime(t0);
      const harness = buildVoidHarness({ holdProvider: true });

      // The claim holds attempt 1 while its provider call is in flight...
      const stale = harness.service.voidRange(RANGE_ID, VOID_REASON);
      const staleSettled = stale.then(
        () => "resolved",
        (error: unknown) => error
      );
      await harness.gateReached;

      // ...its lease goes stale, and a re-drive adopts the same claim as
      // attempt 2: the first attempt's fate is unknown, so submitting again is
      // the only honest move.
      vi.setSystemTime(new Date(t0.getTime() + FISCAL_RANGE_VOID_CLAIM_LEASE_MS + 1_000));
      await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).resolves.toMatchObject({
        outcome: "VOIDED",
      });
      harness.releaseGate();

      await expect(staleSettled).resolves.toMatchObject({
        code: "CONFLICT",
        message: FISCAL_RANGE_VOID_CHANGED_MESSAGE,
      });
      // The stale attempt settles nothing: only the newest attempt's outcome is
      // recorded, even though both submissions left for the provider.
      expect(harness.settled).toHaveLength(1);
      expect(harness.settled[0]?.attempt).toBe(2);
      expect(harness.requests).toHaveLength(2);
      expect(harness.rangeStatus()).toBe("RETIRED");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FiscalProfileService.voidRange — the in-flight claim", () => {
  it("refuses a second void while the first is in flight, and calls the provider exactly once", async () => {
    const harness = buildVoidHarness({ holdProvider: true });

    // The first submission is parked inside provider.voidRange...
    const first = harness.service.voidRange(RANGE_ID, VOID_REASON);
    const firstSettled = first.then(
      (view) => view,
      (error: unknown) => error
    );
    await harness.gateReached;

    // ...and a second arrival meets the claim IN_FLIGHT with a live lease: the
    // named 409, and never a submission of its own.
    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_IN_FLIGHT_MESSAGE,
    });
    // The assertion this fix exists for: the interval reached the tax
    // administration once, not twice.
    expect(harness.requests).toHaveLength(1);
    expect(harness.audit.append).not.toHaveBeenCalled();

    harness.releaseGate();
    await expect(firstSettled).resolves.toMatchObject({ outcome: "VOIDED" });
    expect(harness.requests).toHaveLength(1);
    expect(harness.settled).toHaveLength(1);
    expect(harness.settled[0]?.attempt).toBe(1);
    expect(harness.rangeStatus()).toBe("RETIRED");
  });

  it("refuses a live claim before a document is built, so it never reads credentials", async () => {
    // `requiresDocument: true` makes the check falsifiable: a call that got past
    // the lease check WOULD read the credential port and sign.
    const harness = buildVoidHarness({
      range: voidableRange({ status: "VOIDING" }),
      pendingClaim: { claimedAt: new Date() },
      requiresDocument: true,
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: FISCAL_RANGE_VOID_IN_FLIGHT_MESSAGE,
    });
    expect(harness.credentialReads).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
  });
});

describe("FiscalProfileService.voidRange — the provider's answer", () => {
  it("records a refusal and answers a conflict naming the provider's own reason", async () => {
    const harness = buildVoidHarness({
      result: voidResult({ outcome: "REJECTED", reasonCode: "0400", reason: "Evento rechazado" }),
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Evento rechazado",
    });

    const settled = harness.settled[0];
    expect(settled.outcome).toBe("REJECTED");
    expect(settled.reasonCode).toBe("0400");
    expect(settled.rangeStatus).toBe("ACTIVE");
    // A refusal releases the claim; it must not retire the range as a side
    // effect, because the operator who still wants this authorisation would have
    // lost it and RETIRED has no way back.
    expect(harness.settleCalls()).toBe(1);
    const [input] = harness.audit.append.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(input.action).toBe(FISCAL_RANGE_VOID_FAILED_ACTION);
  });

  it("carries an unlisted result code verbatim into the record (§25.5)", async () => {
    const harness = buildVoidHarness({
      result: voidResult({ outcome: "REJECTED", reasonCode: "9999", reason: null }),
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(harness.settled[0]?.reasonCode).toBe("9999");
  });

  it("rolls the settlement back on either half-failure, so no half-settled state survives", async () => {
    // Either half committed alone would leave the range and its record disagreeing.
    for (const shape of [{ settleRecordFails: true }, { settleRangeFails: true }] as const) {
      const harness = buildVoidHarness(shape);

      await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
        code: "CONFLICT",
        message: FISCAL_RANGE_VOID_CHANGED_MESSAGE,
      });

      expect(harness.rangeStatus()).toBe("VOIDING");
      // The claim survives the rollback exactly as the range does: IN_FLIGHT,
      // with its lease, ready to be adopted once it is stale.
      expect(harness.openClaim()).toMatchObject({ outcome: "IN_FLIGHT", attempt: 1 });
      expect(harness.settled).toHaveLength(0);
      expect(harness.audit.append).not.toHaveBeenCalled();
    }
  });

  it("leaves the claim VOIDING and IN_FLIGHT on a transport failure, and settles nothing", async () => {
    const harness = buildVoidHarness({
      result: voidResult({
        outcome: "TRANSIENT_FAILURE",
        reasonCode: "NETWORK_FAILURE",
        reason: "The connection could not be completed.",
        providerReference: null,
      }),
    });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "The connection could not be completed.",
    });

    // Whether the service received the submission is unknown: the range stays
    // unallocatable and the IN_FLIGHT claim, with its lease, is what a retry
    // adopts once that lease is stale.
    expect(harness.recorded[0]?.outcome).toBe("PENDING");
    expect(harness.recorded[0]?.rangeStatus).toBe("VOIDING");
    expect(harness.openClaim()).toMatchObject({ outcome: "IN_FLIGHT", rangeStatus: "VOIDING" });
    expect(harness.openClaim()?.claimedAt).toBeInstanceOf(Date);
    expect(harness.settled).toHaveLength(0);
    expect(harness.settleCalls()).toBe(0);
  });

  it("records the configuration error a requiring provider answers when no document could be built", async () => {
    // The tenant has no active material, so no honest event exists and the
    // provider — which requires one — refuses with its own reason code. The
    // refusal is recorded, and the range is not touched.
    const harness = buildVoidHarness({ requiresDocument: true, credential: null });

    await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(harness.requests[0]?.document).toBeNull();
    expect(harness.credentialReads).toEqual([{ tenantId: TENANT, environment: "TEST" }]);
    const settled = harness.settled[0];
    expect(settled.reasonCode).toBe("SIGNED_DOCUMENT_REQUIRED");
    expect(settled.rangeStatus).toBe("ACTIVE");
  });
});

describe("FiscalProfileService.voidRange — the deadline", () => {
  it("abandons a hung provider at the deadline, leaving the claim VOIDING and IN_FLIGHT", async () => {
    vi.useFakeTimers();
    try {
      const harness = buildVoidHarness({ hangs: true });

      const pending = harness.service.voidRange(RANGE_ID, VOID_REASON);
      // The rejection is asserted after the timer fires, so nothing here is an
      // unhandled rejection.
      const settled = pending.then(
        () => "resolved",
        (error: unknown) => error
      );
      await vi.advanceTimersByTimeAsync(FISCAL_RANGE_VOID_TIMEOUT_MS);

      await expect(settled).resolves.toMatchObject({
        code: "CONFLICT",
        message: FISCAL_RANGE_VOID_TIMEOUT_REASON,
      });
      // The in-flight call may still land at the provider, so the claim stands:
      // the range stays VOIDING and the record IN_FLIGHT until its lease is
      // stale, which is the only thing that makes adoption safe.
      expect(harness.recorded[0]?.outcome).toBe("PENDING");
      expect(harness.recorded[0]?.rangeStatus).toBe("VOIDING");
      expect(harness.openClaim()).toMatchObject({ outcome: "IN_FLIGHT", attempt: 1 });
      expect(harness.openClaim()?.claimedAt).toBeInstanceOf(Date);
      expect(harness.settled).toHaveLength(0);
      expect(harness.settleCalls()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adopts the timed-out claim once its lease is stale, and submits again because the first fate is unknown", async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-10-11T12:00:00.000Z");
      vi.setSystemTime(t0);
      const harness = buildVoidHarness({ hangs: true });

      const first = harness.service.voidRange(RANGE_ID, VOID_REASON);
      const firstSettled = first.then(
        () => "resolved",
        (error: unknown) => error
      );
      await vi.advanceTimersByTimeAsync(FISCAL_RANGE_VOID_TIMEOUT_MS);
      await expect(firstSettled).resolves.toMatchObject({ code: "CONFLICT" });

      // A live lease refuses the retry: the first call is still unaccounted
      // for, so a second submission is not yet allowed.
      await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).rejects.toMatchObject({
        code: "CONFLICT",
        message: FISCAL_RANGE_VOID_IN_FLIGHT_MESSAGE,
      });
      expect(harness.requests).toHaveLength(1);

      // Once the lease is stale the claim may be adopted, and the interval is
      // submitted again: the first attempt may have reached the service, but
      // refusing to try again would wedge the range forever.
      vi.setSystemTime(new Date(t0.getTime() + FISCAL_RANGE_VOID_CLAIM_LEASE_MS + 1_000));
      await expect(harness.service.voidRange(RANGE_ID, VOID_REASON)).resolves.toMatchObject({
        outcome: "VOIDED",
      });
      expect(harness.requests).toHaveLength(2);
      expect(harness.requests[1]?.from).toBe(42);
      expect(harness.settled[0]?.attempt).toBe(2);
      expect(harness.rangeStatus()).toBe("RETIRED");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isRangeVoidClaimStale", () => {
  it("calls a claim stale exactly at the window, and live before it", () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    const at = (offsetMs: number) => new Date(now.getTime() - offsetMs);

    expect(
      isRangeVoidClaimStale({ claimedAt: at(FISCAL_RANGE_VOID_CLAIM_LEASE_MS - 1) }, now)
    ).toBe(false);
    expect(isRangeVoidClaimStale({ claimedAt: at(FISCAL_RANGE_VOID_CLAIM_LEASE_MS) }, now)).toBe(
      true
    );
    // A record that never entered flight has no lease to live by, and adopting
    // it is the only way it can ever be settled.
    expect(isRangeVoidClaimStale({ claimedAt: null }, now)).toBe(true);
  });
});

describe("the API's inutilización composition (WU-D)", () => {
  it("builds and signs the event a requiring provider submits, with @Id 1 and no document identity", () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    const range = voidableRange({ nextNumber: 42, series: "AA" });

    const document = buildInutilizacionEventDocument({
      range,
      establishmentCode: "001",
      iTiDE: 1,
      reason: VOID_REASON,
      fromNumber: 42,
      toNumber: 9_999_999,
      now,
      credential: CREDENTIAL,
    });

    // An inutilización names a number range and no document (§25.3), so the
    // carrier reports no document identity rather than a fabricated one.
    expect(document.cdc).toBeNull();
    // The facade's serializer accepts the hand-off surface, which is what makes
    // the composition and the submission agree on the group root (§25.1).
    expect(() =>
      serializeEventReception({ dId: "123456789012345", eventGroupXml: document.signedXml })
    ).not.toThrow();
    expect(document.signedXml).toContain("<rGeVeInu>");
    expect(document.signedXml).toContain(`<rEve Id="${FISCAL_RANGE_VOID_EVENT_ID}">`);
    expect(document.signedXml).toContain("<dNumTim>12345678</dNumTim>");
    expect(document.signedXml).toContain("<dEst>001</dEst>");
    expect(document.signedXml).toContain("<dPunExp>001</dPunExp>");
    // `tdNumDE` wants seven digits, so the interval is the EMITTED form.
    expect(document.signedXml).toContain("<dNumIn>0000042</dNumIn>");
    expect(document.signedXml).toContain("<dNumFin>9999999</dNumFin>");
    expect(document.signedXml).toContain("<iTiDE>1</iTiDE>");
    expect(document.signedXml).toContain(`<mOtEve>${VOID_REASON}</mOtEve>`);
    expect(document.signedXml).toContain("<dSerieNum>AA</dSerieNum>");
    expect(document.signedXml).not.toContain("<Id>");
    // Signed for real: the placeholder is gone, exactly one signature sits
    // beside the event, and the private key never travels with the bytes.
    expect(document.signedXml).not.toContain(EVENT_SIGNATURE_PLACEHOLDER);
    expect(document.signedXml.match(/<Signature[\s>]/g) ?? []).toHaveLength(1);
    expect(document.signedXml).not.toContain(FIXTURE_PRIVATE_KEY_PEM.split("\n")[1] ?? "");
  });

  it("omits dSerieNum for the seriesless initial range, which is a state and not a gap", () => {
    const document = buildInutilizacionEventDocument({
      range: voidableRange({ series: null }),
      establishmentCode: "001",
      iTiDE: 1,
      reason: VOID_REASON,
      fromNumber: 42,
      toNumber: 9_999_999,
      now: new Date("2026-10-11T12:00:00.000Z"),
      credential: CREDENTIAL,
    });

    expect(document.signedXml).not.toContain("<dSerieNum>");
  });

  it("narrows the range's document type once, so the payload cannot carry an undeclared one", () => {
    expect(assertRangeVoidable(voidableRange({ documentType: 9 }), VOID_REASON)).toBe(9);
    // The event's own enumeration is WIDER than the range's (2, 3 and 8 are
    // event-legal and DE-illegal), which is why the narrowing is by membership
    // and not by the DE's set.
    expect(assertRangeVoidable(voidableRange({ documentType: 2 }), VOID_REASON)).toBe(2);
    // 10 is the other way round: DE-legal, event-illegal, and therefore refused.
    expect(() => assertRangeVoidable(voidableRange({ documentType: 10 }), VOID_REASON)).toThrow(
      DomainError
    );
  });
});

describe("mapFiscalRangeVoidOutcome", () => {
  it("accepts only VOIDED, and reports the rest as refusals", () => {
    expect(mapFiscalRangeVoidOutcome(voidResult({ outcome: "VOIDED" })).accepted).toBe(true);
    for (const outcome of ["REJECTED", "CONFIGURATION_ERROR", "TRANSIENT_FAILURE"] as const) {
      expect(mapFiscalRangeVoidOutcome(voidResult({ outcome })).accepted).toBe(false);
    }
  });

  it("scrubs the provider's text the way the cancellation's error columns do", () => {
    const write = mapFiscalRangeVoidOutcome(
      voidResult({
        outcome: "REJECTED",
        reasonCode: "0400\n0401",
        reason: "line one\nline two",
        providerReference: "ref\t1",
      })
    );

    expect(write.reasonCode).toBe("0400 0401");
    expect(write.providerReason).toBe("line one line two");
    expect(write.providerReference).toBe("ref 1");
  });

  it("caps every text value and keeps a missing one null", () => {
    const write = mapFiscalRangeVoidOutcome(
      voidResult({ reason: "x".repeat(900), reasonCode: null, providerReference: null })
    );

    expect(write.providerReason).toHaveLength(500);
    expect(write.reasonCode).toBeNull();
    expect(write.providerReference).toBeNull();
  });
});
