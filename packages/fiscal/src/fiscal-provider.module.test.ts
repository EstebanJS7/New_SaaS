import type {
  DynamicModule,
  InjectionToken,
  OptionalFactoryDependency,
  Provider,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  createNullFiscalCredentialPort,
  FISCAL_CREDENTIAL_PORT,
  type FiscalCredentialPort,
  type FiscalTransportCredential,
} from "./fiscal-credential.port.js";
import {
  buildSelectedFiscalProvider,
  FISCAL_PROVIDER_ENV_VALUES,
  FiscalProviderModule,
  resolveFiscalProvider,
  resolveSifenEnvironment,
} from "./fiscal-provider.module.js";
import { FISCAL_PROVIDER, type FiscalIssueRequest } from "./fiscal-provider.port.js";

/**
 * Pins the production refusal defense-in-depth copy at the package composition
 * root. The authoritative `apiEnvSchema` gate is covered by the API config suite.
 */
describe("fiscal provider resolution", () => {
  it("returns undefined outside production when nothing is configured", () => {
    expect(resolveFiscalProvider("development", undefined)).toBeUndefined();
    expect(resolveFiscalProvider("test", undefined)).toBeUndefined();
    expect(resolveFiscalProvider(undefined, undefined)).toBeUndefined();
  });

  it("accepts the explicit fake value in every environment", () => {
    expect(resolveFiscalProvider("development", "fake")).toBe("fake");
    expect(resolveFiscalProvider("test", "fake")).toBe("fake");
    expect(resolveFiscalProvider("production", "fake")).toBe("fake");
  });

  it("accepts the real SIFEN selection in every environment", () => {
    expect(resolveFiscalProvider("development", "sifen-direct")).toBe("sifen-direct");
    expect(resolveFiscalProvider("test", "sifen-direct")).toBe("sifen-direct");
    expect(resolveFiscalProvider("production", "sifen-direct")).toBe("sifen-direct");
  });

  it("refuses an unset provider in production", () => {
    expect(() => resolveFiscalProvider("production", undefined)).toThrow(
      /FISCAL_PROVIDER is required in production/
    );
  });

  it("accepts only the package's closed environment values", () => {
    expect(() => resolveFiscalProvider("development", "third_party")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
    expect(() => resolveFiscalProvider("production", "SIFEN_DIRECT")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
    expect(() => resolveFiscalProvider("test", "sifen_direct")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
  });
});

/**
 * The exported closed set is what both apps' env schemas import and what the
 * factory resolves against, so pinning it makes a silent rename or addition
 * visible in review.
 */
describe("the FISCAL_PROVIDER environment vocabulary", () => {
  it("is one frozen set of environment values", () => {
    expect(FISCAL_PROVIDER_ENV_VALUES).toEqual(["fake", "sifen-direct"]);
    expect(Object.isFrozen(FISCAL_PROVIDER_ENV_VALUES)).toBe(true);
  });
});

/**
 * `SIFEN_ENVIRONMENT` selects the DNIT host the deployment talks to, so an
 * unknown value must refuse rather than silently land on the test host.
 */
describe("SIFEN environment resolution", () => {
  it("defaults to TEST when the variable is absent outside production", () => {
    expect(resolveSifenEnvironment(undefined, "test")).toBe("TEST");
    expect(resolveSifenEnvironment(undefined, "development")).toBe("TEST");
    expect(resolveSifenEnvironment(undefined, undefined)).toBe("TEST");
  });

  it("refuses an absent value in production rather than targeting the test host", () => {
    expect(() => resolveSifenEnvironment(undefined, "production")).toThrow(
      /SIFEN_ENVIRONMENT is required in production/
    );
  });

  it.each(["TEST", "PRODUCTION"] as const)("accepts the explicit %s value", (environment) => {
    expect(resolveSifenEnvironment(environment, "test")).toBe(environment);
    expect(resolveSifenEnvironment(environment, "production")).toBe(environment);
  });

  it("refuses an unknown value instead of falling back to TEST", () => {
    expect(() => resolveSifenEnvironment("STAGING", "test")).toThrow(
      /SIFEN_ENVIRONMENT must be one of: TEST, PRODUCTION/
    );
    expect(() => resolveSifenEnvironment("test", "production")).toThrow(
      /SIFEN_ENVIRONMENT must be one of/
    );
  });
});

/** The smallest request that reaches the adapter's submission path. */
function issueRequest(): FiscalIssueRequest {
  return {
    fiscalDocumentId: "00000000-0000-0000-0000-000000000001",
    tenantId: "tenant-a",
    provider: "SIFEN_DIRECT",
    document: { cdc: "1".repeat(44), signedXml: "<rDE/>" },
    invoice: {
      series: "001",
      number: 1,
      currency: "PYG",
      issuedAt: "2026-10-09T00:00:00.000Z",
    },
    lines: [],
    totals: { taxableBase: "0", taxAmount: "0", total: "0" },
  };
}

describe("buildSelectedFiscalProvider", () => {
  const nullPort = createNullFiscalCredentialPort();

  it("builds the fake for the unset non-production selection", () => {
    const provider = buildSelectedFiscalProvider({
      nodeEnv: "test",
      rawFiscalProvider: undefined,
      rawSifenEnvironment: undefined,
      credentialPort: nullPort,
    });

    expect(provider.provider).toBe("FAKE");
    expect(provider.requiresSignedDocument).toBe(false);
  });

  it("builds the real SIFEN adapter for the sifen-direct selection", () => {
    const provider = buildSelectedFiscalProvider({
      nodeEnv: "test",
      rawFiscalProvider: "sifen-direct",
      rawSifenEnvironment: "TEST",
      credentialPort: nullPort,
    });

    expect(provider.provider).toBe("SIFEN_DIRECT");
    expect(provider.requiresSignedDocument).toBe(true);
  });

  it("keeps a credential-less sifen-direct deployment failing per call, not at boot", async () => {
    // Construction succeeds with the fail-closed default port...
    const provider = buildSelectedFiscalProvider({
      nodeEnv: "test",
      rawFiscalProvider: "sifen-direct",
      rawSifenEnvironment: undefined,
      credentialPort: nullPort,
    });

    // ...and the call answers the terminal configuration error the facade
    // produces for a null credential read, before any document is sent.
    const result = await provider.issue(issueRequest());

    expect(result.outcome).toBe("CONFIGURATION_ERROR");
    expect(result.reasonCode).toBe("CREDENTIAL_UNAVAILABLE");
    expect(result.cdc).toBe("1".repeat(44));
  });

  it("refuses an absent selection in production", () => {
    expect(() =>
      buildSelectedFiscalProvider({
        nodeEnv: "production",
        rawFiscalProvider: undefined,
        rawSifenEnvironment: "PRODUCTION",
        credentialPort: nullPort,
      })
    ).toThrow(/FISCAL_PROVIDER is required in production/);
  });

  it("refuses an unknown SIFEN environment instead of defaulting to TEST", () => {
    expect(() =>
      buildSelectedFiscalProvider({
        nodeEnv: "test",
        rawFiscalProvider: "sifen-direct",
        rawSifenEnvironment: "STAGING",
        credentialPort: nullPort,
      })
    ).toThrow(/SIFEN_ENVIRONMENT must be one of/);
  });
});

/**
 * The module shapes a `Provider` object has — everything but a bare class —
 * without reaching for `any` and without widening past `Provider` itself, which
 * is what makes `Array.prototype.filter` narrow.
 */
type ObjectProvider = Extract<Provider, { provide: unknown }>;

function isObjectProvider(value: unknown): value is ObjectProvider {
  return typeof value === "object" && value !== null && "provide" in value;
}

function providersFor(dynamicModule: DynamicModule, token: InjectionToken): ObjectProvider[] {
  return (dynamicModule.providers ?? [])
    .filter(isObjectProvider)
    .filter((provider) => provider.provide === token);
}

/** `useValue` for the one provider kind that has it; `undefined` otherwise. */
function providerValue(provider: ObjectProvider | undefined): unknown {
  return provider !== undefined && "useValue" in provider ? provider.useValue : undefined;
}

/** `inject` for the one provider kind that has it; `undefined` otherwise. */
function providerInject(
  provider: ObjectProvider | undefined
): readonly (InjectionToken | OptionalFactoryDependency)[] | undefined {
  return provider !== undefined && "inject" in provider ? provider.inject : undefined;
}

function isFiscalCredentialPort(value: unknown): value is FiscalCredentialPort {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    typeof value.read === "function"
  );
}

const UNUSED_CREDENTIAL: FiscalTransportCredential = {
  certificatePem: "-----BEGIN CERTIFICATE-----\nstub\n-----END CERTIFICATE-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nstub\n-----END PRIVATE KEY-----\n",
  notBefore: new Date("2026-01-01T00:00:00.000Z"),
  notAfter: new Date("2027-01-01T00:00:00.000Z"),
};

/**
 * ADR-008 §2: `FiscalProviderModule.forRoot()` declares the credential port with
 * a fail-closed default, and a deployment substitutes it.
 *
 * The assertions read the `DynamicModule` rather than booting a Nest container,
 * because `@nestjs/testing` is not a dependency of this package and adding one
 * for a test would be a dependency change this work unit is not allowed to make.
 * What matters is the wiring the module declares, and that is what is inspected.
 */
describe("FiscalProviderModule.forRoot", () => {
  it("keeps providing and exporting the fiscal provider token", () => {
    const dynamic = FiscalProviderModule.forRoot();

    expect(dynamic.module).toBe(FiscalProviderModule);
    expect(dynamic.providers?.length).toBe(2);
    expect(providersFor(dynamic, FISCAL_PROVIDER)).toHaveLength(1);
    expect(dynamic.exports).toEqual([FISCAL_PROVIDER, FISCAL_CREDENTIAL_PORT]);
  });

  it("injects the credential port into the provider factory", () => {
    const dynamic = FiscalProviderModule.forRoot();
    const provider = providersFor(dynamic, FISCAL_PROVIDER)[0];

    expect(providerInject(provider)).toEqual([FISCAL_CREDENTIAL_PORT]);
  });

  it("declares the fail-closed credential port when none is supplied", async () => {
    const dynamic = FiscalProviderModule.forRoot();
    const providers = providersFor(dynamic, FISCAL_CREDENTIAL_PORT);

    expect(providers).toHaveLength(1);
    const port = providerValue(providers[0]);
    expect(isFiscalCredentialPort(port)).toBe(true);
    if (!isFiscalCredentialPort(port)) {
      throw new Error("The default credential port is not a FiscalCredentialPort.");
    }

    await expect(port.read({ tenantId: "tenant-a", environment: "TEST" })).resolves.toBeNull();
    await expect(
      port.read({ tenantId: "tenant-a", environment: "PRODUCTION" })
    ).resolves.toBeNull();
  });

  it("replaces the default with the supplied provider, never declaring both", async () => {
    const supplied: Provider = {
      provide: FISCAL_CREDENTIAL_PORT,
      useValue: {
        read: (): Promise<FiscalTransportCredential | null> => Promise.resolve(UNUSED_CREDENTIAL),
      },
    };

    const dynamic = FiscalProviderModule.forRoot({ credentialPort: supplied });
    const providers = providersFor(dynamic, FISCAL_CREDENTIAL_PORT);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toBe(supplied);

    const port = providerValue(providers[0]);
    expect(isFiscalCredentialPort(port)).toBe(true);
    if (!isFiscalCredentialPort(port)) {
      throw new Error("The supplied credential port is not a FiscalCredentialPort.");
    }
    await expect(port.read({ tenantId: "tenant-a", environment: "TEST" })).resolves.toBe(
      UNUSED_CREDENTIAL
    );
  });
});
