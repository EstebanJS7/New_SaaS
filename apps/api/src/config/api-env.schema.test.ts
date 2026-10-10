import { describe, expect, it } from "vitest";
import { apiEnv } from "./api-env.js";
import { FISCAL_PROVIDER_ENV_VALUES } from "./api-env.schema.js";
import { readBrandingAssetDeliveryConfig } from "../branding/branding-asset-delivery.service.js";

/** Minimal valid base env: every other required variable has a schema default. */
const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/newsaas",
  REDIS_URL: "redis://localhost:6379",
};

/** Contract values for non-production fallbacks (asserted by literal). */
const DEV_INSECURE_SECRET = "dev-insecure-secret";
const DEV_PUBLIC_BASE_URL = "http://localhost:3001";

const PRODUCTION_SECRET = "p".repeat(64);
const PRODUCTION_PUBLIC_BASE_URL = "https://api.example.test";

/** A syntactically valid production master key ring: version 1, 32 random bytes. */
const PRODUCTION_MASTER_KEYS = `1:${Buffer.alloc(32, 7).toString("base64")}`;

describe("apiEnv branding production gate", () => {
  it("rejects a missing signing secret in production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("BRANDING_ASSET_URL_SECRET");
    }
  });

  it("rejects a signing secret shorter than 32 characters in production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      BRANDING_ASSET_URL_SECRET: "short-secret",
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("BRANDING_ASSET_URL_SECRET");
    }
  });

  it("rejects the dev-insecure signing secret in production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      BRANDING_ASSET_URL_SECRET: DEV_INSECURE_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("BRANDING_ASSET_URL_SECRET");
    }
  });

  it("rejects a missing public base URL in production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("BRANDING_ASSET_PUBLIC_BASE_URL");
    }
  });

  it.each(["http://localhost:3001", "http://127.0.0.1:3001", "http://0.0.0.0:3001"])(
    "rejects the local public base URL %s in production",
    (baseUrl) => {
      const result = apiEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
        BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
        BRANDING_ASSET_PUBLIC_BASE_URL: baseUrl,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("BRANDING_ASSET_PUBLIC_BASE_URL");
      }
    }
  );

  it("accepts a strong secret and a public base URL in production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      FISCAL_PROVIDER: "fake",
      BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.BRANDING_ASSET_URL_SECRET).toBe(PRODUCTION_SECRET);
      expect(result.env.BRANDING_ASSET_PUBLIC_BASE_URL).toBe(PRODUCTION_PUBLIC_BASE_URL);
    }
  });

  it.each(["development", "test"] as const)("allows insecure local defaults in %s", (nodeEnv) => {
    const result = apiEnv({ ...BASE_ENV, NODE_ENV: nodeEnv });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.BRANDING_ASSET_URL_SECRET).toBe(DEV_INSECURE_SECRET);
      expect(result.env.BRANDING_ASSET_PUBLIC_BASE_URL).toBe(DEV_PUBLIC_BASE_URL);
    }
  });

  it("allows explicit local placeholders outside production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "development",
      BRANDING_ASSET_URL_SECRET: DEV_INSECURE_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: "http://localhost:3001",
    });

    expect(result.success).toBe(true);
  });
});

describe("readBrandingAssetDeliveryConfig non-production fallback", () => {
  it("falls back to local defaults outside production", () => {
    const config = readBrandingAssetDeliveryConfig({ NODE_ENV: "development" });

    expect(config.secret).toBe(DEV_INSECURE_SECRET);
    expect(config.publicBaseUrl).toBe(DEV_PUBLIC_BASE_URL);
  });

  it("keeps explicit local placeholders outside production", () => {
    const config = readBrandingAssetDeliveryConfig({
      NODE_ENV: "test",
      BRANDING_ASSET_URL_SECRET: "test-integration-secret",
      BRANDING_ASSET_PUBLIC_BASE_URL: "http://localhost:4111/",
    });

    expect(config.secret).toBe("test-integration-secret");
    expect(config.publicBaseUrl).toBe("http://localhost:4111");
  });

  it("refuses to invent defaults in production", () => {
    expect(() => readBrandingAssetDeliveryConfig({ NODE_ENV: "production" })).toThrow(
      /BRANDING_ASSET_URL_SECRET/
    );
  });

  it("uses explicit production values", () => {
    const config = readBrandingAssetDeliveryConfig({
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });

    expect(config.secret).toBe(PRODUCTION_SECRET);
    expect(config.publicBaseUrl).toBe(PRODUCTION_PUBLIC_BASE_URL);
  });
});

describe("apiEnv fiscal provider selection", () => {
  it.each(["fake", "sifen-direct"] as const)("accepts the closed provider value %s", (provider) => {
    const result = apiEnv({ ...BASE_ENV, FISCAL_PROVIDER: provider });

    expect(result.success).toBe(true);
    if (result.success) expect(result.env.FISCAL_PROVIDER).toBe(provider);
  });

  it.each(["unknown", "SIFEN_DIRECT", "sifen_direct"])("rejects the value %s", (provider) => {
    expect(apiEnv({ ...BASE_ENV, FISCAL_PROVIDER: provider }).success).toBe(false);
  });

  it("pins the API's closed set so the boot gate cannot drift silently", () => {
    expect(FISCAL_PROVIDER_ENV_VALUES).toEqual(["fake", "sifen-direct"]);
  });

  it("requires an explicit provider in production and accepts both values", () => {
    const missing = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error).toContain("FISCAL_PROVIDER");

    for (const provider of ["fake"] as const) {
      expect(
        apiEnv({
          ...BASE_ENV,
          NODE_ENV: "production",
          SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
          FISCAL_PROVIDER: provider,
          BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
          BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
        }).success
      ).toBe(true);
    }

    // `sifen-direct` targets one DNIT host per environment, so production must
    // say which: without it the package's factory would fall back to TEST and
    // build the real adapter against the test host (ADR-008 §3).
    expect(
      apiEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
        FISCAL_PROVIDER: "sifen-direct",
        BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
        BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
      }).success
    ).toBe(false);

    const withoutEnvironment = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
      SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
      FISCAL_PROVIDER: "sifen-direct",
      BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });
    expect(withoutEnvironment.success).toBe(false);
    if (!withoutEnvironment.success) {
      expect(withoutEnvironment.error).toContain("SIFEN_ENVIRONMENT");
    }

    for (const environment of ["TEST", "PRODUCTION"] as const) {
      expect(
        apiEnv({
          ...BASE_ENV,
          NODE_ENV: "production",
          SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
          FISCAL_PROVIDER: "sifen-direct",
          SIFEN_ENVIRONMENT: environment,
          BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
          BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
        }).success
      ).toBe(true);
    }
  });

  it("allows the provider to be unset outside production", () => {
    expect(apiEnv({ ...BASE_ENV, NODE_ENV: "development" }).success).toBe(true);
  });
});

describe("apiEnv production storage gate", () => {
  const PRODUCTION_BUCKET = "newsaas-branding-assets";

  /** Valid production branding env with every pre-existing gate satisfied. */
  const productionBase = {
    ...BASE_ENV,
    NODE_ENV: "production",
    SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
    FISCAL_PROVIDER: "fake",
    BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
    BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
  };

  it("rejects a missing STORAGE_S3_BUCKET when production branding assets are enabled", () => {
    const result = apiEnv({ ...productionBase, BRANDING_ASSETS_ENABLED: "true" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("STORAGE_S3_BUCKET");
    }
  });

  it.each(["", "   "])(
    "rejects a blank STORAGE_S3_BUCKET (%j) when production branding assets are enabled",
    (bucket) => {
      const result = apiEnv({
        ...productionBase,
        BRANDING_ASSETS_ENABLED: "true",
        STORAGE_S3_BUCKET: bucket,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("STORAGE_S3_BUCKET");
      }
    }
  );

  it("accepts a non-empty STORAGE_S3_BUCKET when production branding assets are enabled", () => {
    const result = apiEnv({
      ...productionBase,
      BRANDING_ASSETS_ENABLED: "true",
      STORAGE_S3_BUCKET: PRODUCTION_BUCKET,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.STORAGE_S3_BUCKET).toBe(PRODUCTION_BUCKET);
    }
  });

  it("does not require STORAGE_S3_BUCKET when production branding assets are explicitly disabled", () => {
    const result = apiEnv({ ...productionBase, BRANDING_ASSETS_ENABLED: "false" });

    expect(result.success).toBe(true);
  });

  it("does not require STORAGE_S3_BUCKET in production when the branding flag is omitted", () => {
    const result = apiEnv({ ...productionBase });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.BRANDING_ASSETS_ENABLED).toBe(false);
    }
  });

  it("keeps the fallback outside production even with branding assets enabled", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "development",
      BRANDING_ASSETS_ENABLED: "true",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.STORAGE_S3_BUCKET).toBeUndefined();
    }
  });

  it("keeps endpoint, region, key prefix, and credentials optional", () => {
    const result = apiEnv({
      ...productionBase,
      BRANDING_ASSETS_ENABLED: "true",
      STORAGE_S3_BUCKET: PRODUCTION_BUCKET,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.STORAGE_S3_ENDPOINT).toBeUndefined();
      expect(result.env.STORAGE_S3_REGION).toBeUndefined();
      expect(result.env.STORAGE_S3_KEY_PREFIX).toBeUndefined();
    }
  });

  it("parses optional STORAGE_S3_* overrides when provided", () => {
    const result = apiEnv({
      ...productionBase,
      BRANDING_ASSETS_ENABLED: "true",
      STORAGE_S3_BUCKET: PRODUCTION_BUCKET,
      STORAGE_S3_ENDPOINT: "https://minio.example.test",
      STORAGE_S3_REGION: "sa-east-1",
      STORAGE_S3_KEY_PREFIX: "branding",
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.STORAGE_S3_ENDPOINT).toBe("https://minio.example.test");
      expect(result.env.STORAGE_S3_REGION).toBe("sa-east-1");
      expect(result.env.STORAGE_S3_KEY_PREFIX).toBe("branding");
    }
  });
});

describe("apiEnv production secret-store gate", () => {
  /** Valid production env with every gate satisfied, including the master key. */
  const productionBase = {
    ...BASE_ENV,
    NODE_ENV: "production",
    FISCAL_PROVIDER: "fake",
    BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
    BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    SECRET_STORE_MASTER_KEYS: PRODUCTION_MASTER_KEYS,
  };

  it("rejects a missing SECRET_STORE_MASTER_KEYS in production", () => {
    const { SECRET_STORE_MASTER_KEYS: _omitted, ...withoutMasterKey } = productionBase;
    const result = apiEnv(withoutMasterKey);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("SECRET_STORE_MASTER_KEYS");
    }
  });

  it.each(["", "   "])("rejects a blank SECRET_STORE_MASTER_KEYS (%j) in production", (keys) => {
    const result = apiEnv({ ...productionBase, SECRET_STORE_MASTER_KEYS: keys });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("SECRET_STORE_MASTER_KEYS");
    }
  });

  it("accepts a configured master key ring in production", () => {
    const result = apiEnv(productionBase);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.SECRET_STORE_MASTER_KEYS).toBe(PRODUCTION_MASTER_KEYS);
      expect(result.env.SECRET_STORE_MASTER_KEY_VERSION).toBeUndefined();
    }
  });

  it("parses an explicit current master-key version", () => {
    const result = apiEnv({ ...productionBase, SECRET_STORE_MASTER_KEY_VERSION: "1" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.SECRET_STORE_MASTER_KEY_VERSION).toBe("1");
    }
  });

  it("leaves the master key optional outside production", () => {
    const result = apiEnv(BASE_ENV);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.SECRET_STORE_MASTER_KEYS).toBeUndefined();
    }
  });
});
