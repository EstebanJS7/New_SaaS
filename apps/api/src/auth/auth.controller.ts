import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RequestContextService } from "../context/request-context.service.js";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config.js";
import { AuthService } from "./auth.service.js";
import { PasswordRecoveryService } from "./password-recovery.service.js";
import { Public } from "./public.decorator.js";
import { STAFF_SESSION_COOKIE, staffSessionCookieOptions } from "./session-cookie.js";

/**
 * Login body contract. No password policy exists in this epic (accounts are
 * provisioned by ops/seed); bounds exist purely to reject pathological
 * payloads before any crypto work happens.
 */
const loginBodySchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
  password: z.string().min(1).max(1024),
});

/**
 * Recovery body contract. Bounded exactly like login's, and for the same reason:
 * reject a pathological payload before any lookup, and never let the bounds carry
 * a hint about which addresses exist.
 */
const forgotPasswordBodySchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
});

/** The uniform answer. Identical for a known and an unknown address. */
interface ForgotPasswordResponse {
  readonly status: "accepted";
}

/** Minimal authenticated identity probe (spec: identity / Guard+Context). */
interface MeResponse {
  user: { id: string };
  requestId: string;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly requestContext: RequestContextService,
    // Symbol token (not class type) so tests can override cookie posture.
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly recovery: PasswordRecoveryService
  ) {}

  /** Issues a session and sets the hardened staff cookie (design D4). */
  @Public()
  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const parsed = loginBodySchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }

    const result = await this.auth.login(parsed.data, { ip: request.ip ?? "" });
    reply.setCookie(STAFF_SESSION_COOKIE, result.token, staffSessionCookieOptions(this.config));
    // Status set explicitly: @Res() hijacks Nest's response pipeline.
    await reply.status(200).send({ user: result.user });
  }

  /**
   * Requests a password-reset message (DAT-007).
   *
   * `@Public` because a locked-out user cannot authenticate — which is why this is
   * the most carefully bounded public surface in the system: rate-limited, uniform,
   * and silent about whether the address exists. It answers `202` because the work
   * is accepted rather than done: the message is created as a delivery intent and
   * sent by the delivery path, and the token is minted there.
   */
  @Public()
  @HttpCode(202)
  @Post("forgot-password")
  async forgotPassword(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ForgotPasswordResponse> {
    const parsed = forgotPasswordBodySchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }
    await this.recovery.requestReset(parsed.data.email, request.ip);
    return { status: "accepted" };
  }

  /**
   * Revokes the server-side session (hard delete) and clears the cookie.
   * Protected: only an authenticated session may log itself out.
   */
  @Post("logout")
  async logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    await this.auth.logout(request.cookies?.[STAFF_SESSION_COOKIE]);
    reply.clearCookie(STAFF_SESSION_COOKIE, staffSessionCookieOptions(this.config));
    await reply.status(204).send();
  }

  /**
   * Server-derived identity probe. Values come exclusively from the request
   * context populated by the guard — client-sent identity fields are ignored.
   */
  @Get("me")
  me(): MeResponse {
    return {
      user: { id: this.requestContext.requireUserProfileId() },
      requestId: this.requestContext.getRequestId(),
    };
  }
}
