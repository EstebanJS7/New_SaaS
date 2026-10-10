import { Global, Module, type Provider } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import {
  EnvelopeSecretStore,
  InMemorySecretStore,
  parseSecretStoreKeyRing,
  resolveSecretStoreSelection,
  SECRET_STORE,
  type SecretRecordClient,
  type SecretStore,
} from "@newsaas/secret-store";

/**
 * The worker's own composition root for the tenant secret boundary (ADR-005/D1).
 *
 * It mirrors `apps/api/src/secret-store/secrets.module.ts` on purpose instead of
 * importing it: `packages/secret-store` ships the port, the drivers and the
 * key-ring rules but deliberately no Nest module and no persistence client
 * (ADR-005/D1, DEC-053/D7), because the envelope driver's record client is the
 * application's own Prisma client — and a shared Nest module would make one
 * deployable depend on the other's composition root.
 *
 * The worker needs the store because the fiscal credential reader
 * (`@newsaas/fiscal-persistence`) decrypts the tenant's RESTRICTED private key
 * through it, per call. Nothing in this module reads, logs or returns secret
 * material; only the resolved `SecretStore` crosses the boundary.
 */
export function createSecretStoreFromEnv(
  nodeEnv: string | undefined,
  rawMasterKeys: string | undefined,
  rawMasterKeyVersion: string | undefined,
  records: SecretRecordClient
): SecretStore {
  const keyRing = parseSecretStoreKeyRing(rawMasterKeys, rawMasterKeyVersion);
  // Resolve first, always: the selection helper is the defense-in-depth refusal
  // that must run even when no key ring exists, otherwise a production boot
  // would silently land on the in-memory driver.
  const selection = resolveSecretStoreSelection(nodeEnv, keyRing);
  if (selection === "in-memory" || keyRing === null) {
    return new InMemorySecretStore();
  }
  return new EnvelopeSecretStore(records, keyRing);
}

@Global()
@Module({})
export class SecretsModule {
  static forRoot(): {
    module: typeof SecretsModule;
    providers: Provider[];
    exports: Provider[];
  } {
    const secretStoreProvider: Provider = {
      provide: SECRET_STORE,
      useFactory: (prisma: PrismaService): SecretStore =>
        createSecretStoreFromEnv(
          process.env.NODE_ENV,
          process.env.SECRET_STORE_MASTER_KEYS,
          process.env.SECRET_STORE_MASTER_KEY_VERSION,
          prisma
        ),
      inject: [PrismaService],
    };

    return {
      module: SecretsModule,
      providers: [secretStoreProvider],
      exports: [secretStoreProvider],
    };
  }
}
