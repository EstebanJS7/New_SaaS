import { describe, expect, it } from "vitest";
import { workerEnv } from "./worker-env.js";

/** Minimal valid base env: every other required variable has a schema default. */
const BASE_ENV = {
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgresql://worker:worker@localhost:5432/newsaas_test",
};

const PRODUCTION_BUCKET = "newsaas-branding-assets";

/** Valid production env with the required worker variables present. */
const productionBase = {
  ...BASE_ENV,
  NODE_ENV: "production",
};

describe("workerEnv production storage gate", () => {
  it("rejects a missing STORAGE_S3_BUCKET when production branding assets are enabled", () => {
    const result = workerEnv({ ...productionBase, BRANDING_ASSETS_ENABLED: "true" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("STORAGE_S3_BUCKET");
    }
  });

  it.each(["", "   "])(
    "rejects a blank STORAGE_S3_BUCKET (%j) when production branding assets are enabled",
    (bucket) => {
      const result = workerEnv({
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
    const result = workerEnv({
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
    const result = workerEnv({ ...productionBase, BRANDING_ASSETS_ENABLED: "false" });

    expect(result.success).toBe(true);
  });

  it("does not require STORAGE_S3_BUCKET in production when the branding flag is omitted", () => {
    const result = workerEnv({ ...productionBase });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.BRANDING_ASSETS_ENABLED).toBe(false);
    }
  });

  it("keeps the fallback outside production even with branding assets enabled", () => {
    const result = workerEnv({
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
    const result = workerEnv({
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
    const result = workerEnv({
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

  it("parses BRANDING_ASSETS_ENABLED into a boolean", () => {
    const enabled = workerEnv({ ...BASE_ENV, BRANDING_ASSETS_ENABLED: "true" });
    const disabled = workerEnv({ ...BASE_ENV, BRANDING_ASSETS_ENABLED: "false" });

    expect(enabled.success).toBe(true);
    expect(disabled.success).toBe(true);
    if (enabled.success) {
      expect(enabled.env.BRANDING_ASSETS_ENABLED).toBe(true);
    }
    if (disabled.success) {
      expect(disabled.env.BRANDING_ASSETS_ENABLED).toBe(false);
    }
  });
});
