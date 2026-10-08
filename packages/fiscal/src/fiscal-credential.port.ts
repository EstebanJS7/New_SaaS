/**
 * FISC-010 WU-C — the credential boundary of [[ADR-008]] §2.
 *
 * SIFEN authenticates a client with the taxpayer's certificate (§7.9 of the
 * Manual, quoted in `docs/06-fiscal/SIFEN-BASELINE.md` §7), so every call this
 * package makes needs two pieces of tenant material: a PEM certificate and a
 * PKCS#8 private key. Where those come from is **not** this package's business:
 * the port is declared here, and its implementation lands in the worker
 * ([[FISC-012]]), because reading the material needs Prisma and
 * `@newsaas/secret-store` and `packages/fiscal` must depend on neither.
 *
 * Three properties this module is responsible for, all from ADR-008:
 *
 * 1. **The read is per call, never held.** The provider is a process singleton
 *    (see `fiscal-provider.module.ts`), so the credential is a parameter of an
 *    operation rather than a field of an object. A singleton that cached a
 *    tenant's private key would hold RESTRICTED material across tenants and
 *    would need rotation invalidation.
 * 2. **`null` is a state, not an exception.** A tenant with no active material
 *    for an environment is a configuration state the adapter maps to
 *    `CONFIGURATION_ERROR`, which [[DEC-049]] defines as terminal and
 *    non-retryable. A missing certificate must never become a retry loop.
 * 3. **One definition of the environment vocabulary.** The type is declared
 *    here and re-exported by `apps/api`'s signing-material service, so the
 *    Prisma enum, the API service and this port cannot drift apart.
 *
 * The freshness check is a **pure function of the clock**, exported rather than
 * inlined into the transport so both the local pre-flight check and any later
 * caller agree on the same boundary, and so the boundary is testable without
 * I/O. It is deliberately *not* a handshake failure: an expired certificate
 * refused locally produces `CREDENTIAL_EXPIRED`, not an opaque TLS alert.
 */

/** The two DNIT environments. `SIFEN_ENVIRONMENT` selects one per deployment. */
export type FiscalSigningEnvironment = "TEST" | "PRODUCTION";

/** What mutual TLS needs, and nothing else. */
export interface FiscalTransportCredential {
  /** PEM certificate. Public material: it is presented in the handshake. */
  readonly certificatePem: string;
  /** PKCS#8 PEM private key. RESTRICTED. */
  readonly privateKeyPem: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

/**
 * The injection token the composition root declares and the worker overrides.
 *
 * A `symbol` rather than a string so two independently declared tokens cannot
 * collide by name, which is what Nest's default string tokens allow.
 */
export const FISCAL_CREDENTIAL_PORT = Symbol("FISCAL_CREDENTIAL_PORT");

/**
 * Reads the tenant's active signing material for one environment.
 *
 * The environment is an argument because a tenant may hold `ACTIVE` material for
 * both environments — the partial unique index is
 * `("tenant_id", "environment") WHERE "status" = 'ACTIVE'` — so "the active
 * material" is not a selector. The deployment selects the environment; the
 * tenant's material for that environment authenticates it, and the other
 * environment's certificate is never substituted (ADR-008 §3).
 */
export interface FiscalCredentialPort {
  /** Returns `null` when the tenant has no active material for that environment. */
  read(args: {
    readonly tenantId: string;
    readonly environment: FiscalSigningEnvironment;
  }): Promise<FiscalTransportCredential | null>;
}

/**
 * The fail-closed default: every read answers `null`.
 *
 * This is what `FiscalProviderModule.forRoot()` declares when a deployment wires
 * no real port. A deployment that forgot the wiring therefore fails closed with
 * `CONFIGURATION_ERROR` per call instead of throwing at boot or, worse,
 * succeeding against a certificate it should not have.
 */
export function createNullFiscalCredentialPort(): FiscalCredentialPort {
  return {
    read: () => Promise.resolve(null),
  };
}

/**
 * `notBefore <= now < notAfter`, with the clock as an argument.
 *
 * The upper bound is exclusive because `notAfter` is the instant the certificate
 * stops being valid: a credential whose `notAfter` is exactly `now` is expired.
 * The lower bound is inclusive for the symmetric reason. Pure: no ambient clock,
 * no I/O, no mutation of the credential.
 */
export function isCredentialFresh(credential: FiscalTransportCredential, now: Date): boolean {
  return (
    credential.notBefore.getTime() <= now.getTime() && now.getTime() < credential.notAfter.getTime()
  );
}
