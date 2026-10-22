import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module.js";
import { ApplicationEventsModule } from "../events/application-events.module.js";
import { ContextModule } from "../context/context.module.js";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "./auth.config.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { CredentialService } from "./credential.service.js";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";
import { PasswordRecoveryService } from "./password-recovery.service.js";
import { PasswordResetService } from "./password-reset.service.js";
import { PasswordResetTokenService } from "./password-reset-token.service.js";
import { SessionService } from "./session.service.js";

/**
 * Staff auth surface (design D4 / slice S3).
 *
 * The AuthGuard registers through APP_GUARD so it is GLOBAL for every module
 * composing this one — private-by-default with explicit `@Public` opt-outs
 * (`/health*`, `/auth/login`). Contract-test harnesses that boot only
 * CommonModule stay guard-free by construction; production AppModule always
 * composes AuthModule.
 */
@Module({
  // AuditModule supplies the append-only writer AuthService emits login
  // events through (design D9); ContextModule carries the request context.
  // Deliberately NOT NotificationsModule: a recovery request publishes an event and
  // the notification module's subscriber creates the delivery (DAT-007's decision).
  // Identity therefore knows no queue, no producer and no delivery table.
  //
  // ApplicationEventsModule IS imported explicitly even though it is `@Global`: a
  // global module is only global inside the graph that composes it, and this module
  // is resolved on its own by harnesses that boot AuthModule without AppModule. It is
  // static, so Nest reuses one instance across every importer.
  imports: [ContextModule, AuditModule, ApplicationEventsModule],
  controllers: [AuthController],
  providers: [
    CredentialService,
    SessionService,
    // HARD-002 / DEC-076: the failure budget moves to the SHARED store when
    // REDIS_URL is configured, so the documented threshold stops multiplying by
    // api replica count. The URL is read here rather than inside the service to
    // keep unit tests deterministic.
    {
      provide: LoginRateLimiterService,
      useFactory: (): LoginRateLimiterService => new LoginRateLimiterService(process.env.REDIS_URL),
    },
    PasswordResetTokenService,
    PasswordRecoveryService,
    PasswordResetService,
    AuthService,
    AuthGuard,
    { provide: AUTH_CONFIG, useFactory: (): AuthConfig => readAuthConfig(process.env) },
    // Registered AFTER the services it depends on; global for the whole app.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  // EPIC-08 D2: the portal boundary reuses the SAME argon2id credential
  // boundary, config posture, and failure-budget limiter as staff login while
  // keeping its own session table, cookie, guard, and identity. Exporting
  // these three tokens (not the staff session/guard) is the minimum shared
  // surface; the portal session service is portal-owned.
  exports: [CredentialService, LoginRateLimiterService, AUTH_CONFIG],
})
export class AuthModule {}
