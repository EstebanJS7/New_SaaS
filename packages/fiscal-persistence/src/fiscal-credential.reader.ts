import type { Prisma } from "@newsaas/database";
import type { FiscalCredentialPort } from "@newsaas/fiscal";
import type { SecretStore } from "@newsaas/secret-store";

/**
 * FISC-012 WU-B — the Prisma + SecretStore implementation of the credential
 * port.
 *
 * [[ADR-008]] §2 declared `FiscalCredentialPort` in `packages/fiscal` and said
 * its implementation lands where Prisma and `@newsaas/secret-store` are
 * available. This is it, and it is the only code that reads a tenant's private
 * key.
 *
 * The read, in order:
 *
 * 1. the tenant's ACTIVE material for the requested environment — the tenant and
 *    the environment are both part of the query, so the other environment's
 *    certificate is never substituted and a foreign tenant's row never matches;
 * 2. no row -> `null`. Absence is a state, and the adapter maps it to
 *    `CONFIGURATION_ERROR`, which is terminal;
 * 3. the private key from the `SecretStore` by `credentialRef` -> `null` when the
 *    secret is gone. The row is ACTIVE and its secret is missing: an
 *    inconsistency this boundary fails closed on rather than throwing from, so a
 *    destroyed key cannot become a retry loop or a crash. A CORRUPT secret is
 *    different — `SecretStoreIntegrityError` propagates and the caller decides;
 * 4. the certificate comes from the row, because it is public material, and the
 *    key comes from the store. The certificate is never read from the store and
 *    the key is never read from the row.
 *
 * Nothing here logs, and the returned object carries exactly the port's four
 * fields.
 */

/** The `tenant_fiscal_signing_material` columns this read needs, and nothing else. */
export interface FiscalSigningMaterialReadRow {
  /** Opaque key into `tenant_secret`; never returned to a caller. */
  readonly credentialRef: string;
  /** Public material: it is transmitted inside every signed DE. */
  readonly certificatePem: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

/**
 * The delegate surface, in Prisma's own terms.
 *
 * Declared structurally so the Prisma client fits by construction and a test can
 * pass a fake that records the statements — the same shape the range store uses.
 */
export interface FiscalCredentialReadClient {
  tenantFiscalSigningMaterial: {
    findFirst(
      args: Prisma.TenantFiscalSigningMaterialFindFirstArgs
    ): Promise<FiscalSigningMaterialReadRow | null>;
  };
}

export interface FiscalCredentialReaderArgs {
  readonly client: FiscalCredentialReadClient;
  readonly secretStore: SecretStore;
}

export function createFiscalCredentialReader(
  args: FiscalCredentialReaderArgs
): FiscalCredentialPort {
  const { client, secretStore } = args;
  return {
    async read({ tenantId, environment }) {
      // The partial unique index is `("tenant_id", "environment") WHERE status =
      // 'ACTIVE'`, so this is the tenant's single active material for THIS
      // environment; the other environment's row is not a fallback.
      const row = await client.tenantFiscalSigningMaterial.findFirst({
        where: { tenantId, environment, status: "ACTIVE" },
      });
      if (row === null) {
        return null;
      }

      const privateKeyPem = await secretStore.get({ tenantId, key: row.credentialRef });
      if (privateKeyPem === null) {
        // Fail closed: the material is ACTIVE and its key is gone, so there is
        // nothing to authenticate with. A throw here would be an opaque failure
        // for a state the port already models as "no credential"; a corrupt
        // secret still propagates, because that one is a fault rather than an
        // absence.
        return null;
      }

      return {
        certificatePem: row.certificatePem,
        privateKeyPem,
        notBefore: row.notBefore,
        notAfter: row.notAfter,
      };
    },
  };
}
