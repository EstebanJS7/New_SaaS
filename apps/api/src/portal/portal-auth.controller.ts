import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AUTH_CONFIG, type AuthConfig } from "../auth/auth.config.js";
import { z } from "zod";
import { Public } from "../auth/public.decorator.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PortalAuthService } from "./portal-auth.service.js";
import { portalLoginBodySchema, type PortalMeResponse } from "./portal.dto.js";
import { PORTAL_SESSION_COOKIE, portalSessionCookieOptions } from "./portal-session-cookie.js";
import { PortalPasswordRecoveryService } from "./portal-password-recovery.service.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../auth/password.policy.js";

/** The recovery request body: the tenant the visitor is at, and the address they sign in with. */
const portalForgotPasswordBodySchema = z
  .object({
    tenantSlug: z.string().trim().min(1).max(63),
    email: z.string().trim().min(3).max(254).email(),
  })
  .strict();

/**
 * The reset body: the token and the new password. No slug, because the token is the authority — it
 * names its own access and can only ever change that access's password.
 */
const portalResetPasswordBodySchema = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  })
  .strict();

/**
 * Portal identity surface (EPIC-08 D2/D8) — the isolated twin of
 * `AuthController`. These controllers carry NO staff `@RequirePermissions`
 * metadata: the staff guard chain skips the whole `/portal/*` surface, and the
 * PortalAuthGuard enforces portal policy instead.
 *
 * `@Public` on login is read by the PortalAuthGuard (and by the staff guards,
 * which already skip the surface); it never grants staff access.
 */
@Controller("portal")
export class PortalAuthController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly requestContext: RequestContextService,
    // Symbol token (not class type) so tests can override cookie posture.
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly recovery: PortalPasswordRecoveryService
  ) {}

  /** Issues a portal session and sets the hardened portal cookie. */
  @Public()
  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const parsed = portalLoginBodySchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }

    const result = await this.auth.login(parsed.data, { ip: request.ip ?? "" });
    reply.setCookie(PORTAL_SESSION_COOKIE, result.token, portalSessionCookieOptions(this.config));
    // Status set explicitly: @Res() hijacks Nest's response pipeline.
    await reply.status(200).send({
      portal: {
        portalAccessId: result.portal.portalAccessId,
        customerId: result.portal.customerId,
      },
    });
  }

  /**
   * Revokes the server-side portal session and clears the cookie. Guarded by
   * the PortalAuthGuard: only an authenticated portal session may log out.
   */
  @Post("logout")
  async logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    await this.auth.logout(request.cookies?.[PORTAL_SESSION_COOKIE]);
    reply.clearCookie(PORTAL_SESSION_COOKIE, portalSessionCookieOptions(this.config));
    await reply.status(204).send();
  }

  /**
   * Requests a portal password-recovery message ([[PORTAL-002]]).
   *
   * `@Public` for the same reason the login is: the caller cannot authenticate — that is the
   * situation being recovered from. It answers `202` identically for a holder that exists, one that
   * does not, an ambiguous login identity and a holder with no credential, and the envelope carries
   * no field that could distinguish them.
   *
   * The body takes the tenant slug because the portal surface is `/[slug]/…` and the holder is
   * resolved within that tenant, exactly as the login resolves it.
   */
  @Public()
  @HttpCode(202)
  @Post("forgot-password")
  async forgotPassword(@Body() body: unknown): Promise<{ status: "accepted" }> {
    const parsed = portalForgotPasswordBodySchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }
    await this.recovery.requestReset(parsed.data.tenantSlug, parsed.data.email, "");
    return { status: "accepted" };
  }

  /**
   * Consumes a portal reset link ([[PORTAL-002]]).
   *
   * The token IS the credential, and a bad one is refused exactly like a failed login: one code, one
   * message, no hint about whether the link was unknown, spent or expired. There is no tenant slug in
   * the body because the token is the authority: it names its own access, and it can only ever change
   * that access's password.
   */
  @Public()
  @HttpCode(200)
  @Post("password-reset")
  async resetPassword(@Body() body: unknown): Promise<{ status: "reset" }> {
    const parsed = portalResetPasswordBodySchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }
    await this.recovery.resetPassword(parsed.data.token, parsed.data.password);
    return { status: "reset" };
  }

  /**
   * Server-derived portal identity probe. Values come exclusively from the
   * request context populated by the PortalAuthGuard — client-sent identity
   * fields are ignored.
   */
  @Get("me")
  me(): PortalMeResponse {
    return {
      portal: {
        portalAccessId: this.requestContext.requirePortalAccessId(),
        customerId: this.requestContext.requirePortalCustomerId(),
      },
      requestId: this.requestContext.getRequestId(),
    };
  }
}
