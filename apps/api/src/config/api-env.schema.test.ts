import { describe, expect, it } from "vitest";
import { apiEnv } from "./api-env.js";
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

describe("apiEnv branding production gate", () => {
  it("rejects a missing signing secret in production", () => {
    const result = apiEnv({
      ...BASE_ENV,
      NODE_ENV: "production",
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
      BRANDING_ASSET_URL_SECRET: PRODUCTION_SECRET,
      BRANDING_ASSET_PUBLIC_BASE_URL: PRODUCTION_PUBLIC_BASE_URL,
    });

    expect(config.secret).toBe(PRODUCTION_SECRET);
    expect(config.publicBaseUrl).toBe(PRODUCTION_PUBLIC_BASE_URL);
  });
});

describe("apiEnv production storage gate", () => {
  const PRODUCTION_BUCKET = "newsaas-branding-assets";

  /** Valid production branding env with every pre-existing gate satisfied. */
  const productionBase = {
    ...BASE_ENV,
    NODE_ENV: "production",
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
