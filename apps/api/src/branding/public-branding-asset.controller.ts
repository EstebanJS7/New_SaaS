import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import type { FastifyReply } from "fastify";
import { Public } from "../auth/public.decorator.js";
import { BrandingAssetDeliveryService } from "./branding-asset-delivery.service.js";
import { BrandingAssetPipe } from "./branding-asset.pipe.js";

/**
 * Anonymous, token-verified branding asset delivery for the customer portal.
 *
 * This is NOT a staff surface: no session, permission, or request-context
 * tenant is consulted. Instead the API-local HMAC signature proves the token
 * was minted by the server for a specific asset id, so the route can stream
 * exactly that asset. Storage keys, buckets and provider paths never leave the
 * server.
 */
@Controller("api/v1/public/branding/assets")
export class PublicBrandingAssetController {
  constructor(
    private readonly assetPipe: BrandingAssetPipe,
    private readonly delivery: BrandingAssetDeliveryService
  ) {}

  @Public()
  @Get(":kind/content")
  async getContent(
    @Param("kind") kind: string,
    @Query("token") token: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<void> {
    const validatedKind = this.assetPipe.assertKind(kind);
    if (typeof token !== "string" || token.length === 0) {
      throw new DomainError("VALIDATION_FAILED", "Missing asset URL token.");
    }
    await this.delivery.streamPublic({ kind: validatedKind, token }, reply);
  }
}
