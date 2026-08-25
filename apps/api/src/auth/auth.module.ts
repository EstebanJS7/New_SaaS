import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ContextModule } from "../context/context.module.js";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "./auth.config.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { CredentialService } from "./credential.service.js";
import { LoginRateLimiterService } from "./login-rate-limiter.service.js";
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
  imports: [ContextModule],
  controllers: [AuthController],
  providers: [
    CredentialService,
    SessionService,
    LoginRateLimiterService,
    AuthService,
    AuthGuard,
    { provide: AUTH_CONFIG, useFactory: (): AuthConfig => readAuthConfig(process.env) },
    // Registered AFTER the services it depends on; global for the whole app.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
