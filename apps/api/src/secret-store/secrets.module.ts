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
 * Application composition root for the tenant secret boundary (ADR-005/D1).
 *
 * `packages/secret-store` ships the port, the drivers and the key-ring rules but
 * no Nest module, because the persistent driver's record client is the
 * application's own Prisma client. That selection lives here — the same
 * "port + drivers in a package, selection in the app" split `StorageModule`
 * uses, with one difference: this capability cannot resolve its driver from its
 * own environment alone, because it also needs that client.
 *
 * `PrismaService` satisfies {@link SecretRecordClient} structurally, so no
 * adapter class is needed: a caller that owns a transaction passes `tx` and the
 * store writes through it.
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
