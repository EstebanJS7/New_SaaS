import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { z } from "zod";
import type { FastifyReply } from "fastify";
import { RequestContextService } from "../context/request-context.service.js";
import {
  DEV_BRANDING_ASSET_PUBLIC_BASE_URL,
  DEV_INSECURE_BRANDING_ASSET_URL_SECRET,
} from "../config/api-env.schema.js";
import { DEFAULT_SIGNED_URL_TTL_SECONDS, STORAGE_PORT, type StoragePort } from "@newsaas/storage";
import type { BrandingAssetKind } from "./branding-asset.pipe.js";

/**
 * Branding-only view of the process environment. The fields are optional here
 * because the global `apiEnvSchema` (parsed once at startup) owns the
 * production values; this schema only supplies a non-production fallback so
 * local development and tests keep working without extra configuration.
 */
const deliveryEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BRANDING_ASSET_URL_SECRET: z.string().min(1).optional(),
  /**
   * Public origin used to build absolute asset URLs for the unauthenticated
   * portal. The API serves the bytes, so the URL must be API-origin absolute;
   * it must never be a storage-provider URL.
   */
  BRANDING_ASSET_PUBLIC_BASE_URL: z.string().url().optional(),
});

export interface BrandingAssetDeliveryConfig {
  readonly secret: string;
  readonly ttlSeconds: number;
  /** API public origin, without a trailing slash. */
  readonly publicBaseUrl: string;
}

/** DI token for {@link BrandingAssetDeliveryConfig}; override in tests. */
export const BRANDING_ASSET_DELIVERY_CONFIG = Symbol("BRANDING_ASSET_DELIVERY_CONFIG");

/**
 * Resolves a branding delivery value, preferring the explicit environment
 * value. Outside production it falls back to the shared local default; in
 * production the global `apiEnvSchema` gate already guarantees the value, so a
 * missing one is a hard error rather than a silent insecure fallback.
 */
function resolveBrandingValue(
  explicit: string | undefined,
  fallback: string,
  nodeEnv: "development" | "production" | "test",
  variableName: string
): string {
  if (explicit !== undefined) {
    return explicit;
  }
  if (nodeEnv === "production") {
    throw new Error(
      `${variableName} is required in production. The API must not fall back to an insecure branding default.`
    );
  }
  return fallback;
}

export function readBrandingAssetDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env
): BrandingAssetDeliveryConfig {
  const parsed = deliveryEnvSchema.parse(env);
  const secret = resolveBrandingValue(
    parsed.BRANDING_ASSET_URL_SECRET,
    DEV_INSECURE_BRANDING_ASSET_URL_SECRET,
    parsed.NODE_ENV,
    "BRANDING_ASSET_URL_SECRET"
  );
  const publicBaseUrl = resolveBrandingValue(
    parsed.BRANDING_ASSET_PUBLIC_BASE_URL,
    DEV_BRANDING_ASSET_PUBLIC_BASE_URL,
    parsed.NODE_ENV,
    "BRANDING_ASSET_PUBLIC_BASE_URL"
  );
  return {
    secret,
    ttlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
}

/** Signed-URL audience: staff uses the private route, portal the public one. */
export type BrandingAssetUrlAudience = "staff" | "public";

/**
 * Payload carried in an API-local signed asset URL. The token never contains
 * the storage key, bucket, or provider path — only the tenant-scoped asset kind,
 * asset id, and an expiration timestamp.
 */
interface AssetUrlToken {
  kind: BrandingAssetKind;
  assetId: string;
  exp: number;
}

interface DecodedToken extends AssetUrlToken {
  signature: string;
}

/**
 * API-local asset delivery boundary.
 *
 * - Signs URLs that point to the application's own asset proxy endpoint, not
 *   to the underlying object-storage provider.
 * - Verifies signatures with constant-time comparison and strict expiration.
 * - Binds each signed URL to a specific asset id so replacement naturally
 *   revokes prior URLs.
 * - Resolves the tenant from the authenticated request context and streams the
 *   asset bytes from storage without exposing keys, buckets, or paths.
 */
@Injectable()
export class BrandingAssetDeliveryService {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    @Inject(BRANDING_ASSET_DELIVERY_CONFIG)
    private readonly config: BrandingAssetDeliveryConfig
  ) {}

  /**
   * Returns an API-local signed URL for the current tenant's asset of the
   * given kind. The URL is valid for `ttlSeconds`.
   *
   * If `assetId` is omitted, the current asset for the tenant+kind is looked up
   * and bound into the token.
   */
  async signClientUrl(kind: BrandingAssetKind, assetId?: string): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    return this.signClientUrlForTenant(tenantId, kind, assetId, "staff");
  }

  /**
   * Returns an API-local signed URL for an explicit tenant's asset. Used by
   * resolution surfaces that already validated the tenant scope (e.g. the
   * public branding endpoint) and cannot rely on an authenticated request
   * context.
   *
   * The `audience` selects the delivery route: staff URLs stay relative to the
   * staff web origin and require an authenticated request; public portal URLs
   * are absolute (API origin) and target the anonymous, token-verified route.
   * Both carry the same API-local HMAC signature and never a storage key.
   */
  async signClientUrlForTenant(
    tenantId: string,
    kind: BrandingAssetKind,
    assetId?: string,
    audience: BrandingAssetUrlAudience = "staff"
  ): Promise<string> {
    const boundAssetId = assetId ?? (await this.requireAssetIdForTenant(tenantId, kind));
    const token = this.createToken(kind, boundAssetId);
    return this.buildUrl(kind, token, audience);
  }

  /**
   * Verifies the signed URL token, resolves the asset for the current tenant,
   * and streams its bytes to the Fastify reply. Storage keys, buckets, and
   * provider paths never leave the server.
   */
  async stream(
    args: { kind: BrandingAssetKind; token: string },
    reply: FastifyReply
  ): Promise<void> {
    const decoded = this.decodeAndVerifyToken(args.token, args.kind);

    if (decoded.exp < Date.now()) {
      throw new DomainError("FORBIDDEN", "Signed asset URL has expired.");
    }

    const tenantId = this.requestContext.requireTenantId();
    const asset = await this.findAssetForTenant(tenantId, args.kind);
    if (asset?.id !== decoded.assetId) {
      throw new DomainError("NOT_FOUND", "Branding asset not found.");
    }

    await this.sendAsset(asset.assetKey, reply, "private, no-cache");
  }

  /**
   * Anonymous token-verified delivery for the customer portal. The tenant is
   * not read from any client input: the HMAC signature binds the token to a
   * specific asset id, which is looked up directly. Storage keys, buckets and
   * provider paths never leave the server.
   */
  async streamPublic(
    args: { kind: BrandingAssetKind; token: string },
    reply: FastifyReply
  ): Promise<void> {
    const decoded = this.decodeAndVerifyToken(args.token, args.kind);

    if (decoded.exp < Date.now()) {
      throw new DomainError("FORBIDDEN", "Signed asset URL has expired.");
    }

    const asset = await this.findAssetById(decoded.assetId);
    if (asset?.kind !== kindToEnum(args.kind)) {
      throw new DomainError("NOT_FOUND", "Branding asset not found.");
    }

    await this.sendAsset(asset.assetKey, reply, "public, max-age=300");
  }

  private createToken(kind: BrandingAssetKind, assetId: string): string {
    const exp = Date.now() + this.config.ttlSeconds * 1000;
    const payload: AssetUrlToken = { kind, assetId, exp };
    const signature = this.sign(payload);
    return Buffer.from(JSON.stringify({ ...payload, signature })).toString("base64url");
  }

  private buildUrl(
    kind: BrandingAssetKind,
    token: string,
    audience: BrandingAssetUrlAudience
  ): string {
    const relative = `/branding/assets/${kind}/content?token=${token}`;
    if (audience === "staff") {
      return relative;
    }
    return `${this.config.publicBaseUrl}/api/v1/public${relative}`;
  }

  private async sendAsset(
    assetKey: string,
    reply: FastifyReply,
    cacheControl: string
  ): Promise<void> {
    const object = await this.storage.get({ key: assetKey });
    reply.header("Content-Type", object.contentType);
    reply.header("Cache-Control", cacheControl);
    reply.send(object.body);
  }

  private async findAssetById(
    assetId: string
  ): Promise<{ id: string; assetKey: string; kind: string } | null> {
    const asset = await this.prisma.brandingAsset.findUnique({
      where: { id: assetId },
      select: { id: true, assetKey: true, kind: true },
    });
    return asset ?? null;
  }

  private async requireAssetIdForTenant(
    tenantId: string,
    kind: BrandingAssetKind
  ): Promise<string> {
    const asset = await this.findAssetForTenant(tenantId, kind);
    if (!asset) {
      throw new DomainError("NOT_FOUND", "Branding asset not found.");
    }
    return asset.id;
  }

  private async findAssetForTenant(
    tenantId: string,
    kind: BrandingAssetKind
  ): Promise<{ id: string; assetKey: string } | null> {
    const enumValue = kindToEnum(kind);
    const asset = await this.prisma.brandingAsset.findFirst({
      where: { tenantId, kind: enumValue },
      select: { id: true, assetKey: true },
    });
    return asset ?? null;
  }

  private decodeAndVerifyToken(token: string, expectedKind: BrandingAssetKind): AssetUrlToken {
    let decoded: DecodedToken;
    try {
      decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as DecodedToken;
    } catch {
      throw new DomainError("VALIDATION_FAILED", "Invalid asset URL token.");
    }

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.signature !== "string" ||
      typeof decoded.kind !== "string" ||
      typeof decoded.assetId !== "string" ||
      typeof decoded.exp !== "number"
    ) {
      throw new DomainError("VALIDATION_FAILED", "Invalid asset URL token.");
    }

    if (decoded.kind !== expectedKind) {
      throw new DomainError("VALIDATION_FAILED", "Asset URL kind mismatch.");
    }

    const { signature, ...payload } = decoded;
    const expectedSignature = this.sign(payload);
    const signatureBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
      throw new DomainError("VALIDATION_FAILED", "Invalid asset URL signature.");
    }

    return payload;
  }

  private sign(payload: AssetUrlToken): string {
    return createHmac("sha256", this.config.secret)
      .update(JSON.stringify(payload))
      .digest("base64url");
  }
}

function kindToEnum(kind: BrandingAssetKind): "LOGO_LIGHT" | "LOGO_DARK" | "FAVICON" {
  return (
    {
      logoLight: "LOGO_LIGHT",
      logoDark: "LOGO_DARK",
      favicon: "FAVICON",
    } as const
  )[kind];
}

/** Default TTL re-exported for the module provider. */
export { DEFAULT_SIGNED_URL_TTL_SECONDS };
