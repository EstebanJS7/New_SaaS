import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AUTH_CONFIG, type AuthConfig } from "../auth/auth.config.js";
import { Public } from "../auth/public.decorator.js";
import { RequestContextService } from "../context/request-context.service.js";
import { PortalAuthService } from "./portal-auth.service.js";
import { portalLoginBodySchema, type PortalMeResponse } from "./portal.dto.js";
import { PORTAL_SESSION_COOKIE, portalSessionCookieOptions } from "./portal-session-cookie.js";

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
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
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
