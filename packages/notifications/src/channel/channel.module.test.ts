import { describe, expect, it } from "vitest";
import {
  buildNotificationChannels,
  NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
  NOTIFICATION_WHATSAPP_PROVIDER_ENV_VALUES,
  resolveChannelProvider,
} from "./channel.module.js";
import type { NotificationChannelProviderId } from "./channel.port.js";
import { createFakeNotificationChannel } from "./fake.channel.js";

const request = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  deliveryId: "22222222-2222-2222-2222-222222222222",
  recipient: "person@example.test",
  subject: "Recordatorio",
  body: "Su turno es mañana.",
  parameters: ["mañana"],
};

const SMTP_ENV = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "user",
  SMTP_PASSWORD: "secret",
  NOTIFICATION_EMAIL_FROM: "no-reply@example.test",
};

const WHATSAPP_ENV = {
  WHATSAPP_CLOUD_TOKEN: "token",
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: "123456",
  WHATSAPP_CLOUD_TEMPLATE_NAME: "appointment_reminder",
  WHATSAPP_CLOUD_TEMPLATE_LANGUAGE: "es",
};

/**
 * The selection is the safety path [[DEC-061]] names, so it is tested as a pure
 * function rather than only through a Nest factory: an untested refusal is one
 * that regresses silently.
 */
describe("channel provider selection", () => {
  it("returns undefined outside production when the value is absent", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      expect(
        resolveChannelProvider({
          nodeEnv,
          rawValue: undefined,
          accepted: NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
          envVar: "EMAIL_PROVIDER",
        })
      ).toBeUndefined();
    }
  });

  it("refuses an absent value in production, by variable name", () => {
    expect(() =>
      resolveChannelProvider({
        nodeEnv: "production",
        rawValue: undefined,
        accepted: NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
        envVar: "EMAIL_PROVIDER",
      })
    ).toThrow(/EMAIL_PROVIDER is required in production/);

    expect(() =>
      resolveChannelProvider({
        nodeEnv: "production",
        rawValue: undefined,
        accepted: NOTIFICATION_WHATSAPP_PROVIDER_ENV_VALUES,
        envVar: "WHATSAPP_PROVIDER",
      })
    ).toThrow(/WHATSAPP_PROVIDER is required in production/);
  });

  it("refuses an unknown value by name and never falls back", () => {
    expect(() =>
      resolveChannelProvider({
        nodeEnv: "production",
        rawValue: "ses",
        accepted: NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
        envVar: "EMAIL_PROVIDER",
      })
    ).toThrow(/EMAIL_PROVIDER must be one of: fake, smtp\./);

    expect(() =>
      resolveChannelProvider({
        nodeEnv: "development",
        rawValue: "SMTP",
        accepted: NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
        envVar: "EMAIL_PROVIDER",
      })
    ).toThrow(/EMAIL_PROVIDER must be one of/);
  });

  it("accepts the explicit fake in every environment, including production", () => {
    // The refusal is about ABSENCE, not about the fake: the fake is the
    // documented dedicated-demo path, and selecting it already takes an operator
    // typing it on purpose.
    for (const nodeEnv of ["development", "test", "production"]) {
      expect(
        resolveChannelProvider({
          nodeEnv,
          rawValue: "fake",
          accepted: NOTIFICATION_EMAIL_PROVIDER_ENV_VALUES,
          envVar: "EMAIL_PROVIDER",
        })
      ).toBe("fake");
    }
  });
});

describe("buildNotificationChannels", () => {
  const providers = (args: Parameters<typeof buildNotificationChannels>[0]) => {
    const channels = buildNotificationChannels(args);
    const ids: Record<string, NotificationChannelProviderId> = {
      EMAIL: channels.for("EMAIL").providerId,
      WHATSAPP: channels.for("WHATSAPP").providerId,
    };
    return { channels, ids };
  };

  it("resolves both channels to the fake in development with nothing configured", () => {
    const { channels, ids } = providers({ nodeEnv: "development", env: {} });
    expect(ids).toEqual({ EMAIL: "FAKE", WHATSAPP: "FAKE" });
    // ...every channel is a real, deterministic object rather than a stub that
    // throws or does nothing.
    for (const channel of ["EMAIL", "WHATSAPP"] as const) {
      expect(typeof channels.for(channel).send).toBe("function");
    }
  });

  it("builds the real adapters for the explicit real selections", () => {
    const { ids } = providers({
      nodeEnv: "production",
      env: {
        EMAIL_PROVIDER: "smtp",
        WHATSAPP_PROVIDER: "whatsapp-cloud",
        ...SMTP_ENV,
        ...WHATSAPP_ENV,
      },
    });
    expect(ids).toEqual({ EMAIL: "SMTP", WHATSAPP: "WHATSAPP_CLOUD" });
  });

  it("refuses a real selection whose deployment inputs are missing, by variable name", () => {
    // Stricter than the fiscal credential's per-call refusal on purpose: an SMTP
    // endpoint is one deployment's configuration, not one tenant's state, so a
    // deployment that cannot send for anyone must not boot.
    expect(() =>
      buildNotificationChannels({
        nodeEnv: "production",
        env: {
          EMAIL_PROVIDER: "smtp",
          WHATSAPP_PROVIDER: "fake",
          ...SMTP_ENV,
          SMTP_HOST: undefined,
        },
      })
    ).toThrow(/SMTP_HOST is required when the smtp provider is selected/);

    expect(() =>
      buildNotificationChannels({
        nodeEnv: "production",
        env: {
          EMAIL_PROVIDER: "smtp",
          WHATSAPP_PROVIDER: "whatsapp-cloud",
          ...SMTP_ENV,
          WHATSAPP_CLOUD_TOKEN: undefined,
        },
      })
    ).toThrow(/WHATSAPP_CLOUD_TOKEN is required when the whatsapp-cloud provider is selected/);
  });

  it("refuses a port with trailing text, which parseInt used to accept — TD-040 R3-003", () => {
    // `parseInt("587abc", 10)` is 587, so a typo in a deployment input silently
    // became a different port.
    expect(() =>
      buildNotificationChannels({
        nodeEnv: "production",
        env: {
          EMAIL_PROVIDER: "smtp",
          WHATSAPP_PROVIDER: "fake",
          ...SMTP_ENV,
          SMTP_PORT: "587abc",
        },
      })
    ).toThrow(/SMTP_PORT must be a port number/);
  });

  it("accepts the exact port and refuses the boundaries", () => {
    const withPort = (SMTP_PORT: string) => ({
      nodeEnv: "production",
      env: { EMAIL_PROVIDER: "smtp", WHATSAPP_PROVIDER: "fake", ...SMTP_ENV, SMTP_PORT },
    });
    expect(() => buildNotificationChannels(withPort("587"))).not.toThrow();
    for (const bad of ["0", "65536", "-1", "smtp", "5 8 7"]) {
      expect(() => buildNotificationChannels(withPort(bad)), bad).toThrow(/must be a port number/);
    }
  });

  it("refuses a port that is not a port", () => {
    expect(() =>
      buildNotificationChannels({
        nodeEnv: "production",
        env: { EMAIL_PROVIDER: "smtp", WHATSAPP_PROVIDER: "fake", ...SMTP_ENV, SMTP_PORT: "smtp" },
      })
    ).toThrow(/SMTP_PORT must be a port number/);
  });

  it("lets a deployable substitute one channel without knowing the selection rules", async () => {
    const scripted = createFakeNotificationChannel({ channel: "WHATSAPP", outcomes: ["SENT"] });
    const { ids, channels } = providers({
      nodeEnv: "development",
      env: {},
      overrides: { WHATSAPP: scripted },
    });
    expect(ids).toEqual({ EMAIL: "FAKE", WHATSAPP: "FAKE" });
    expect(channels.for("WHATSAPP")).toBe(scripted);
    await expect(channels.for("WHATSAPP").send(request)).resolves.toEqual({
      outcome: "SENT",
      providerReference: "fake-whatsapp-1",
    });
  });
});
