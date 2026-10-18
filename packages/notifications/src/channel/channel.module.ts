import { Module, type DynamicModule } from "@nestjs/common";
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationChannelPort,
  type NotificationChannels,
} from "./channel.port.js";
import { createFakeNotificationChannel } from "./fake.channel.js";
import { createSmtpEmailChannel, type SmtpEmailConfig } from "./email.channel.js";
import { createWhatsAppCloudChannel, type WhatsAppCloudConfig } from "./whatsapp.channel.js";

/**
 * The closed set of accepted `EMAIL_PROVIDER` values.
 *
 * Exported so an app's env schema and this module validate against ONE list: a
 * per-deployable copy is a copy that drifts, and this value decides which
 * implementation the process runs.
 */
export const NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES = Object.freeze(["fake", "smtp"] as const);
/** The closed set of accepted `WHATSAPP_PROVIDER` values. */
export const NOTIFICATION_WHATSAPP_PROVIDER_ENV_VALUES = Object.freeze([
  "fake",
  "whatsapp-cloud",
] as const);

export type NotificationEmailProviderEnvValue =
  (typeof NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES)[number];
export type NotificationWhatsAppProviderEnvValue =
  (typeof NOTIFICATION_WHATSAPP_PROVIDER_ENV_VALUES)[number];

/**
 * The environment variable a channel's selection is read from.
 *
 * One variable per channel rather than one for both, because the two are
 * independent deployment decisions: a deployment can send real email and no
 * WhatsApp (PRD §24 makes WhatsApp transactional and [[DEC-058]] makes it
 * entitled), and a single selector would force one answer for both.
 */
export const NOTIFICATION_PROVIDER_ENV_VARS = Object.freeze({
  EMAIL: "EMAIL_PROVIDER",
  WHATSAPP: "WHATSAPP_PROVIDER",
} as const satisfies Readonly<Record<NotificationChannel, string>>);

/** The environment variables a real adapter needs, named so a boot refusal can cite them. */
export const NOTIFICATION_EMAIL_ENV_VARS = Object.freeze({
  host: "SMTP_HOST",
  port: "SMTP_PORT",
  secure: "SMTP_SECURE",
  user: "SMTP_USER",
  password: "SMTP_PASSWORD",
  from: "NOTIFICATION_EMAIL_FROM",
});

export const NOTIFICATION_WHATSAPP_ENV_VARS = Object.freeze({
  token: "WHATSAPP_CLOUD_TOKEN",
  phoneNumberId: "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  templateName: "WHATSAPP_CLOUD_TEMPLATE_NAME",
  templateLanguage: "WHATSAPP_CLOUD_TEMPLATE_LANGUAGE",
  baseUrl: "WHATSAPP_CLOUD_API_BASE_URL",
});

/**
 * Resolves one channel's provider from its environment value.
 *
 * Pure and exported so the production refusal is unit-tested rather than living
 * only inside a Nest factory: an untested safety path is one that regresses
 * silently (the `resolveFiscalProvider` precedent, [[DEC-061]]).
 *
 * The refusal is about **absence**, never about the fake. An explicit `"fake"`
 * stays selectable in production because it is the documented dedicated-demo
 * path; refusing it would break that deployment without protecting anything,
 * since selecting the fake already takes an operator typing it on purpose.
 */
export function resolveChannelProvider<TValue extends string>(args: {
  readonly nodeEnv: string | undefined;
  readonly rawValue: string | undefined;
  readonly accepted: readonly TValue[];
  readonly envVar: string;
}): TValue | undefined {
  if (args.rawValue === undefined) {
    if (args.nodeEnv === "production") {
      throw new Error(`${args.envVar} is required in production.`);
    }
    return undefined;
  }
  const selection = args.accepted.find((candidate) => candidate === args.rawValue);
  if (selection === undefined) {
    throw new Error(`${args.envVar} must be one of: ${args.accepted.join(", ")}.`);
  }
  return selection;
}

/** Reads a variable that a selected real adapter cannot run without. */
function requireEnv(env: EnvRecord, name: string, provider: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required when the ${provider} provider is selected.`);
  }
  return value;
}

type EnvRecord = Readonly<Record<string, string | undefined>>;

export interface BuildNotificationChannelsArgs {
  readonly nodeEnv: string | undefined;
  readonly env: EnvRecord;
  /**
   * Replaces a channel's provider wholesale. It exists so a test can drive the
   * resolver with a scripted fake and a deployable can substitute one channel
   * without knowing the selection rules — never to bypass them: a substitution
   * here IS the deployment's answer for that channel.
   */
  readonly overrides?: Partial<Record<NotificationChannel, NotificationChannelPort>>;
}

/**
 * Builds the provider for every channel, for the resolved selection.
 *
 * A real selection validates its own deployment inputs **at build time** and
 * refuses by name, which is deliberately stricter than the fiscal credential's
 * per-call refusal: a tenant's signing material is tenant state that may exist
 * for one tenant and not another, while an SMTP endpoint is one deployment's
 * configuration. A deployment that selects `smtp` without a host cannot send for
 * anyone, so failing at boot is the honest answer rather than a process that
 * boots and then fails every delivery with the same missing variable.
 */
export function buildNotificationChannels(
  args: BuildNotificationChannelsArgs
): NotificationChannels {
  const email = args.overrides?.EMAIL ?? buildEmailChannel(args);
  const whatsapp = args.overrides?.WHATSAPP ?? buildWhatsAppChannel(args);
  const byChannel: Record<NotificationChannel, NotificationChannelPort> = {
    EMAIL: email,
    WHATSAPP: whatsapp,
  };

  return {
    for: (channel) => byChannel[channel],
  };
}

function buildEmailChannel(args: BuildNotificationChannelsArgs): NotificationChannelPort {
  const provider = resolveChannelProvider({
    nodeEnv: args.nodeEnv,
    rawValue: args.env[NOTIFICATION_PROVIDER_ENV_VARS.EMAIL],
    accepted: NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
    envVar: NOTIFICATION_PROVIDER_ENV_VARS.EMAIL,
  });

  switch (provider) {
    case undefined:
    case "fake":
      return createFakeNotificationChannel({ channel: "EMAIL" });
    case "smtp": {
      const config: SmtpEmailConfig = {
        host: requireEnv(args.env, NOTIFICATION_EMAIL_ENV_VARS.host, "smtp"),
        port: readPort(args.env, NOTIFICATION_EMAIL_ENV_VARS.port),
        secure: args.env[NOTIFICATION_EMAIL_ENV_VARS.secure] === "true",
        user: requireEnv(args.env, NOTIFICATION_EMAIL_ENV_VARS.user, "smtp"),
        password: requireEnv(args.env, NOTIFICATION_EMAIL_ENV_VARS.password, "smtp"),
        from: requireEnv(args.env, NOTIFICATION_EMAIL_ENV_VARS.from, "smtp"),
      };
      return createSmtpEmailChannel({ config });
    }
  }
}

function buildWhatsAppChannel(args: BuildNotificationChannelsArgs): NotificationChannelPort {
  const provider = resolveChannelProvider({
    nodeEnv: args.nodeEnv,
    rawValue: args.env[NOTIFICATION_PROVIDER_ENV_VARS.WHATSAPP],
    accepted: NOTIFICATION_WHATSAPP_PROVIDER_ENV_VALUES,
    envVar: NOTIFICATION_PROVIDER_ENV_VARS.WHATSAPP,
  });

  switch (provider) {
    case undefined:
    case "fake":
      return createFakeNotificationChannel({ channel: "WHATSAPP" });
    case "whatsapp-cloud": {
      const config: WhatsAppCloudConfig = {
        token: requireEnv(args.env, NOTIFICATION_WHATSAPP_ENV_VARS.token, "whatsapp-cloud"),
        phoneNumberId: requireEnv(
          args.env,
          NOTIFICATION_WHATSAPP_ENV_VARS.phoneNumberId,
          "whatsapp-cloud"
        ),
        templateName: requireEnv(
          args.env,
          NOTIFICATION_WHATSAPP_ENV_VARS.templateName,
          "whatsapp-cloud"
        ),
        templateLanguage: requireEnv(
          args.env,
          NOTIFICATION_WHATSAPP_ENV_VARS.templateLanguage,
          "whatsapp-cloud"
        ),
        baseUrl: args.env[NOTIFICATION_WHATSAPP_ENV_VARS.baseUrl],
      };
      return createWhatsAppCloudChannel({ config });
    }
  }
}

function readPort(env: EnvRecord, name: string): number {
  const raw = requireEnv(env, name, "smtp");
  // Digits only, and THEN convert. Two leniencies had to be refused, not one
  // (TD-040 R3-003, corrected by TD-042 R3-2): `parseInt("587abc", 10)` is 587,
  // and `Number("1e3")` is 1000 — so `Number` alone would still accept a
  // scientific-notation port and `Number("0x10")` would be 16.
  if (!/^[0-9]{1,5}$/.test(raw)) {
    throw new Error(`${name} must be a port number, got "${raw}".`);
  }
  const port = Number(raw);
  if (port <= 0 || port > 65_535) {
    throw new Error(`${name} must be a port number, got "${raw}".`);
  }
  return port;
}

export interface NotificationChannelsModuleOptions {
  readonly overrides?: Partial<Record<NotificationChannel, NotificationChannelPort>>;
}

/**
 * The channel selection's composition root.
 *
 * It reads `process.env` directly rather than calling an app's env parser,
 * matching `FiscalProviderModule`: a factory validates what IT needs, so
 * module-level tests can boot the composition root without a database or Redis,
 * and each deployable's schema stays the authoritative gate it already is.
 *
 * Both channels always resolve to a real provider. There is no silent fallback:
 * an absent value outside production is the documented development default (the
 * fake), and an absent value IN production is refused at boot by name, because a
 * deployment that names no provider must fail loudly rather than quietly
 * delivering nothing ([[DEC-061]]).
 */
@Module({})
export class NotificationChannelsModule {
  static forRoot(options: NotificationChannelsModuleOptions = {}): DynamicModule {
    return {
      module: NotificationChannelsModule,
      providers: [
        {
          provide: NOTIFICATION_CHANNELS,
          useFactory: () =>
            buildNotificationChannels({
              nodeEnv: process.env.NODE_ENV,
              env: process.env,
              overrides: options.overrides,
            }),
        },
      ],
      exports: [NOTIFICATION_CHANNELS],
    };
  }
}
