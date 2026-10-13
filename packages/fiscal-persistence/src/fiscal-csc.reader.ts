import type { Prisma } from "@newsaas/database";
import type { FiscalSigningEnvironment } from "@newsaas/fiscal";
import type { SecretStore } from "@newsaas/secret-store";

/**
 * FISC-015 WU-C — the Prisma + SecretStore implementation of the CSC read.
 *
 * The CSC is the code SIFEN issues **per taxpayer** and that the QR's hash needs
 * (SIFEN-BASELINE.md §24.2, §24.3). It is secret by the sources' own words — the
 * Manual says twice that it must never be shared and never be sent in the URL —
 * so it is handled exactly as the private key is: the row carries an opaque
 * `secretRef` and the value lives sealed in `tenant_secret`. This mirrors
 * `fiscal-credential.reader.ts`, field for field.
 *
 * The read, in order:
 *
 * 1. the tenant's ACTIVE CSC row for the requested environment — the tenant and
 *    the environment are both in the query, so the other environment's code is
 *    never substituted and a foreign tenant's row never matches;
 * 2. no row -> `null`. Absence is a state: the tenant has not registered its
 *    CSC, which [[DEC-057]] Q3 chose over inventing one;
 * 3. the value from the `SecretStore` by `secretRef` -> `null` when the secret is
 *    gone. The row is ACTIVE and its secret is missing: an inconsistency this
 *    boundary fails closed on rather than throwing from, so a destroyed secret
 *    cannot become a retry loop or a crash. A CORRUPT secret is different —
 *    `SecretStoreIntegrityError` propagates and the caller decides;
 * 4. the identifier comes from the row, because the QR carries it, and the value
 *    comes from the store. Neither is read from the other's side.
 *
 * **Nothing here logs**, and the returned object is RESTRICTED material: it must
 * not enter a log, a DTO, an API response, an error message or a snapshot. Only
 * `idCsc` is printable, and only because the QR already carries it.
 */

/** The `tenant_fiscal_csc` columns this read needs, and nothing else. */
export interface FiscalCscReadRow {
  /** The QR's `IdCSC` (§24.3): the identifier, never the value. */
  readonly idCsc: string;
  /** Opaque key into `tenant_secret`; never returned to a caller. */
  readonly secretRef: string;
}

/** The tenant's CSC for one environment: the identifier and the sealed value. */
export interface FiscalCsc {
  /** `IdCSC`, four characters (§24.3). Not secret. */
  readonly idCsc: string;
  /** The CSC itself. RESTRICTED: hashed into the QR and never emitted. */
  readonly csc: string;
}

/**
 * The port-shaped read this package implements.
 *
 * It is declared here rather than in `packages/fiscal`, because that package
 * owns no CSC port today and adding one is not this work unit's surface. Its
 * shape is the credential port's, so the composition root wires it the same way.
 */
export interface FiscalCscPort {
  /** Returns `null` when the tenant has no ACTIVE CSC for that environment. */
  read(args: {
    readonly tenantId: string;
    readonly environment: FiscalSigningEnvironment;
  }): Promise<FiscalCsc | null>;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * Declared structurally so the Prisma client fits by construction and a test can
 * pass a fake that records the statements.
 */
export interface FiscalCscReadClient {
  tenantFiscalCsc: {
    findFirst(args: Prisma.TenantFiscalCscFindFirstArgs): Promise<FiscalCscReadRow | null>;
  };
}

export interface FiscalCscReaderArgs {
  readonly client: FiscalCscReadClient;
  readonly secretStore: SecretStore;
}

export function createFiscalCscReader(args: FiscalCscReaderArgs): FiscalCscPort {
  const { client, secretStore } = args;
  return {
    async read({ tenantId, environment }) {
      // The partial unique index is `("tenant_id", "environment", "id_csc")
      // WHERE status = 'ACTIVE'` plus the at-most-two trigger, so a tenant may
      // hold two ACTIVE codes here. Which one is used is not this read's
      // decision: the row is the first ACTIVE for THIS environment, and the
      // caller that needs a specific identifier names it by `idCsc`.
      const row = await client.tenantFiscalCsc.findFirst({
        where: { tenantId, environment, status: "ACTIVE" },
        orderBy: { idCsc: "asc" },
      });
      if (row === null) {
        return null;
      }

      const csc = await secretStore.get({ tenantId, key: row.secretRef });
      if (csc === null) {
        // Fail closed: the row is ACTIVE and its value is gone, so there is
        // nothing to hash into the QR. A throw here would be an opaque failure
        // for a state the port already models as "no CSC"; a corrupt secret
        // still propagates, because that one is a fault rather than an absence.
        return null;
      }

      return { idCsc: row.idCsc, csc };
    },
  };
}
