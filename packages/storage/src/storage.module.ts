import { Global, Module, Provider } from "@nestjs/common";
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  S3_STORAGE_CONFIG,
  STORAGE_PORT,
} from "./storage.constants.js";
import { InMemoryStorageDriver } from "./in-memory-storage.driver.js";
import { S3StorageConfig, S3StorageDriver } from "./s3-storage.driver.js";

/**
 * Platform object-storage module. Exports the abstract StoragePort so domains
 * remain decoupled from any provider.
 *
 * Driver selection:
 * - If STORAGE_S3_BUCKET is present, wire the S3-compatible driver.
 * - Otherwise, fall back to the in-memory driver (tests/local development).
 */
@Global()
@Module({})
export class StorageModule {
  static forRoot(): {
    module: typeof StorageModule;
    providers: Provider[];
    exports: Provider[];
  } {
    const s3Config = StorageModule.resolveS3Config();

    const configProvider: Provider = {
      provide: S3_STORAGE_CONFIG,
      useValue: s3Config,
    };

    const storagePortProvider: Provider = {
      provide: STORAGE_PORT,
      useFactory: (config: S3StorageConfig | null) => {
        if (config?.bucket) {
          return new S3StorageDriver(config);
        }
        return new InMemoryStorageDriver();
      },
      inject: [S3_STORAGE_CONFIG],
    };

    return {
      module: StorageModule,
      providers: [configProvider, storagePortProvider],
      exports: [storagePortProvider],
    };
  }

  private static resolveS3Config(): S3StorageConfig | null {
    const bucket = process.env.STORAGE_S3_BUCKET;
    if (!bucket) {
      return null;
    }
    return {
      bucket,
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      region: process.env.STORAGE_S3_REGION,
      keyPrefix: process.env.STORAGE_S3_KEY_PREFIX,
    };
  }
}

export { DEFAULT_SIGNED_URL_TTL_SECONDS, STORAGE_PORT, S3_STORAGE_CONFIG };
export type { StoragePort } from "./storage.port.js";
export { InMemoryStorageDriver } from "./in-memory-storage.driver.js";
export { S3StorageDriver, type S3StorageConfig } from "./s3-storage.driver.js";
export { createOpaqueStorageKey, STORAGE_KEY_PREFIXES } from "./storage-keys.js";
