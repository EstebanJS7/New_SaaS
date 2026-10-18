import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RequestContextService } from "../context/request-context.service.js";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config.js";
import { AuthService } from "./auth.service.js";
import { PasswordRecoveryService } from "./password-recovery.service.js";
import { PasswordResetService } from "./password-reset.service.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password.policy.js";
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

/**
 * The reset body contract. The token's bound mirrors the entropy it carries (43
 * base64url characters) with room to spare; the password's mirrors login's, because
 * this repository has no password policy yet and inventing one here would be a
 * product decision taken by an implementation ([[DAT-007]]'s limitation).
 */
const resetPasswordBodySchema = z.object({
  token: z.string().min(1).max(512),
  // The bounds come from the policy module rather than being written twice: a schema
  // that accepted a password the credential boundary refuses would be a 500 where a
  // 400 belongs.
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

/** The uniform answer. Identical for a known and an unknown address. */
interface ForgotPasswordResponse {
  readonly status: "accepted";
}

/** The reset's answer: the password changed and every session ended. */
interface ResetPasswordResponse {
  readonly status: "reset";
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
    private readonly recovery: PasswordRecoveryService,
    private readonly reset: PasswordResetService
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
   * Consumes a reset link and changes the password (DAT-007 WU-C2).
   *
   * `@Public` for the same reason the request is: the caller cannot authenticate —
   * that is the situation being recovered from. The token IS the credential, and a
   * bad one is refused exactly like a failed login: one code, one message, no hint
   * about whether the link was unknown, spent or expired.
   */
  @Public()
  @HttpCode(200)
  @Post("password-reset")
  async resetPassword(@Body() body: unknown): Promise<ResetPasswordResponse> {
    const parsed = resetPasswordBodySchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error; // Global filter => VALIDATION_FAILED envelope.
    }
    await this.reset.resetPassword(parsed.data.token, parsed.data.password);
    return { status: "reset" };
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
