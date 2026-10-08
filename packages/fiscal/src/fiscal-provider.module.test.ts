import type { DynamicModule, InjectionToken, Provider } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  FISCAL_CREDENTIAL_PORT,
  type FiscalCredentialPort,
  type FiscalTransportCredential,
} from "./fiscal-credential.port.js";
import { FiscalProviderModule, resolveFiscalProvider } from "./fiscal-provider.module.js";
import { FISCAL_PROVIDER } from "./fiscal-provider.port.js";

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

  it("refuses an unset provider in production", () => {
    expect(() => resolveFiscalProvider("production", undefined)).toThrow(
      /FISCAL_PROVIDER is required in production/
    );
  });

  it("accepts only the package's closed fake-provider value", () => {
    expect(() => resolveFiscalProvider("development", "third_party")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
    expect(() => resolveFiscalProvider("production", "SIFEN_DIRECT")).toThrow(
      /FISCAL_PROVIDER must be one of/
    );
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
