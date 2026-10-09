import type { Prisma } from "@newsaas/database";
import type { StoredActivity, StoredEmitterProfile, StoredEstablishment } from "@newsaas/fiscal";

/**
 * FISC-012 WU-B — the worker's read of the emitter profile, its activities and
 * one establishment.
 *
 * FISC-011's `assembleEmitterProfile` takes the stored rows as arguments; this is
 * the read that produces them, and it is deliberately the only place that turns a
 * `fiscal_emitter_profile`, `fiscal_emitter_activity` or `fiscal_establishment`
 * column into a `Stored*` field.
 *
 * **`tenantId` is an argument, not ambient context.** The API's repository
 * resolves it from `RequestContextService`; the worker has no request, so every
 * query here takes the tenant and puts it in the `where` clause. A foreign id can
 * therefore only produce `null`, never another tenant's row.
 *
 * **The mapping is 1:1 on the columns the `Stored*` shapes declare, and nothing
 * is defaulted.** Each shape in `packages/fiscal` names the protocol columns it
 * carries; a column the schema marks nullable stays `null` here, and a column the
 * shape requires is read as it is. A default would emit a DE field nobody chose.
 *
 * **Absence is a state, not an error.** A tenant with no profile and an
 * establishment that is not the tenant's are both `null`: the same rule the
 * credential port uses, and the caller decides whether that state is terminal.
 *
 * **Why the client is structural, with Prisma's own argument types.** The same
 * reason the range store is: the adapter is declared against the delegate's
 * argument types so the Prisma client fits by construction, and a test can pass a
 * fake that records the statements. The read is two statements — the profile,
 * then its ordered activities — rather than one `include`, because each client
 * method returns exactly the column shape this module maps and no statement's
 * result depends on how it was called.
 */

/** One `fiscal_emitter_profile` row, in the columns the stored profile declares. */
export interface FiscalEmitterProfileRow {
  /** The row's identity: it scopes the activities read, and is not emitted. */
  readonly id: string;
  readonly ruc: string;
  readonly checkDigit: string;
  readonly taxpayerType: number;
  readonly regimeCode: number | null;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly responsibleIssuerType: number | null;
  readonly responsibleIssuerTypeName: string | null;
  readonly responsibleIssuerId: string | null;
  readonly responsibleIssuerName: string | null;
  readonly responsibleIssuerRole: string | null;
  readonly transactionType: number | null;
  readonly taxType: number;
  readonly emissionType: number;
}

/** One `fiscal_emitter_activity` row: the two `gActEco` columns. */
export interface FiscalEmitterActivityRow {
  readonly code: string;
  readonly description: string;
}

/** One `fiscal_establishment` row, in the columns the stored establishment declares. */
export interface FiscalEstablishmentRow {
  readonly code: string;
  readonly addressLine: string;
  readonly houseNumber: number;
  readonly addressComplement1: string | null;
  readonly addressComplement2: string | null;
  readonly departmentCode: number;
  readonly districtCode: number | null;
  readonly districtName: string | null;
  readonly cityCode: number;
  readonly cityName: string;
  readonly phone: string;
  readonly email: string;
  readonly branchName: string | null;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * The returned shapes are the columns this module maps, not Prisma's full row: a
 * full payload is assignable to each of them because the extra columns are simply
 * not required.
 */
export interface FiscalProfileReadClient {
  fiscalEmitterProfile: {
    findUnique(
      args: Prisma.FiscalEmitterProfileFindUniqueArgs
    ): Promise<FiscalEmitterProfileRow | null>;
  };
  fiscalEmitterActivity: {
    findMany(
      args: Prisma.FiscalEmitterActivityFindManyArgs
    ): Promise<readonly FiscalEmitterActivityRow[]>;
  };
  fiscalEstablishment: {
    findFirst(
      args: Prisma.FiscalEstablishmentFindFirstArgs
    ): Promise<FiscalEstablishmentRow | null>;
  };
}

export function createFiscalProfileReader(client: FiscalProfileReadClient): {
  /** The tenant's emitter profile and its activities, or null when there is none. */
  readProfile(tenantId: string): Promise<{
    profile: StoredEmitterProfile;
    activities: readonly StoredActivity[];
  } | null>;
  /** One establishment of the tenant, by id. */
  readEstablishment(tenantId: string, establishmentId: string): Promise<StoredEstablishment | null>;
} {
  return {
    async readProfile(tenantId) {
      // `tenantId` is `@unique` on the profile, so this is the tenant's single
      // profile rather than the first of several.
      const row = await client.fiscalEmitterProfile.findUnique({ where: { tenantId } });
      if (row === null) {
        return null;
      }
      // `position` is the stored `gActEco` order and is not emitted: the DE
      // carries the activities in the order the query returns them.
      const activities = await client.fiscalEmitterActivity.findMany({
        where: { tenantId, profileId: row.id },
        orderBy: { position: "asc" },
      });
      return {
        profile: toStoredProfile(row),
        activities: activities.map(({ code, description }) => ({ code, description })),
      };
    },

    async readEstablishment(tenantId, establishmentId) {
      const row = await client.fiscalEstablishment.findFirst({
        where: { tenantId, id: establishmentId },
      });
      return row === null ? null : toStoredEstablishment(row);
    },
  };
}

function toStoredProfile(row: FiscalEmitterProfileRow): StoredEmitterProfile {
  return {
    ruc: row.ruc,
    checkDigit: row.checkDigit,
    taxpayerType: row.taxpayerType,
    regimeCode: row.regimeCode,
    legalName: row.legalName,
    tradeName: row.tradeName,
    responsibleIssuerType: row.responsibleIssuerType,
    responsibleIssuerTypeName: row.responsibleIssuerTypeName,
    responsibleIssuerId: row.responsibleIssuerId,
    responsibleIssuerName: row.responsibleIssuerName,
    responsibleIssuerRole: row.responsibleIssuerRole,
    transactionType: row.transactionType,
    taxType: row.taxType,
    emissionType: row.emissionType,
  };
}

function toStoredEstablishment(row: FiscalEstablishmentRow): StoredEstablishment {
  return {
    code: row.code,
    addressLine: row.addressLine,
    houseNumber: row.houseNumber,
    addressComplement1: row.addressComplement1,
    addressComplement2: row.addressComplement2,
    departmentCode: row.departmentCode,
    districtCode: row.districtCode,
    districtName: row.districtName,
    cityCode: row.cityCode,
    cityName: row.cityName,
    phone: row.phone,
    email: row.email,
    branchName: row.branchName,
  };
}
