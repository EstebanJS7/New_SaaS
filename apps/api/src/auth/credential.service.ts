import { Inject, Injectable } from "@nestjs/common";
import argon2 from "argon2";
import { AUTH_CONFIG, type AuthConfig } from "./auth.config.js";

/**
 * Password hashing boundary (design D4, spec: identity / Argon2id storage).
 *
 * Hashes are RESTRICTED-classified material: they are produced here and
 * verified here, and no method returns or accepts them beyond the caller that
 * persists/reads the credentials row. Parameters default to the OWASP floor
 * (argon2id, m=19456 KiB, t=2, p=1) and stay env-tunable through AuthConfig.
 */
@Injectable()
export class CredentialService {
  constructor(
    // Symbol token: structural Pick<> types carry no usable design:type metadata.
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig
  ) {}

  private get options(): argon2.HashOptions {
    return {
      type: argon2.argon2id,
      memoryCost: this.config.argonMemoryCost,
      timeCost: this.config.argonTimeCost,
      parallelism: this.config.argonParallelism,
    };
  }

  /** Derives an argon2id hash (random salt embedded in the PHC string). */
  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  /**
   * Constant-time verification: argon2 derives the candidate key from the
   * embedded parameters/salt and compares digests without early exits on the
   * secret. Wrong passwords cost the same as correct ones.
   */
  verify(password: string, hash: string): Promise<boolean> {
    // A malformed/corrupt stored hash can only mean "no match" — surface it
    // as a failed verification instead of a 500.
    return argon2.verify(hash, password).catch(() => false);
  }

  /**
   * Hash with THIS service's configured parameters — used by tests to build
   * fixtures and by provisioning flows that must match runtime settings.
   */
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.options);
  }
}
