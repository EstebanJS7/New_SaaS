vi.mock("next/headers", () => ({
  __esModule: true,
  headers: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));
vi.mock("@/components/shell/route-feedback", () => ({ RouteFeedback: () => null }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { cookies, headers } from "next/headers";
import { activeProductPreset } from "@newsaas/ui/branding";
import { readCspNonce } from "@/lib/csp-nonce";
import RootLayout from "./layout";
import AppShellLayout from "./(app)/layout";
import PortalLayout from "./(portal)/layout";

/**
 * CSP nonce wiring across all three layouts ([[DEC-075]] / [[HARD-001]]).
 *
 * The policy is asserted in `lib/csp.test.ts` and `middleware.test.ts`. This suite
 * asserts the other half of the same control: that the inline `<script>` and
 * `<style>` a layout actually renders carry the nonce the response's policy
 * declares. A policy with a nonce nothing stamps is a blocked document, and a
 * nonce on a node the policy does not name is the same failure — so the two tests
 * together are what prove the control, not either alone.
 *
 * The three layouts emit inline nodes for the same reason and each is covered
 * independently: the root document (pre-paint appearance), the staff shell
 * (tenant brand overrides) and the portal shell (public tenant brand).
 */

const NONCE = "0f8c2b41-7d6e-4a90-b3c5-1e2f3a4b5c6d";

function mockRequestWithNonce(nonce: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ "x-nonce": nonce }));
  vi.mocked(cookies).mockResolvedValue({
    toString: () => "",
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
    clear: () => undefined,
    size: 0,
  } as never);
}

function expectInlineNodesToCarryNonce(container: HTMLElement, nonce: string): void {
  const scripts = Array.from(container.querySelectorAll("script"));
  const styles = Array.from(container.querySelectorAll("style"));

  // The layouts are the reason the policy cannot be `style-src 'self'`; if either
  // node disappears this suite should be revisited rather than pass vacuously.
  expect(scripts.length).toBeGreaterThan(0);
  expect(styles.length).toBeGreaterThan(0);

  for (const node of [...scripts, ...styles]) {
    expect(node.getAttribute("nonce")).toBe(nonce);
  }
}

describe("CSP nonce reaches every inline node (HARD-001)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ source: "tenant", brand: { defaultAppearance: "dark" } }),
    });
  });

  it("stamps the root layout's pre-paint script and preset style", async () => {
    mockRequestWithNonce(NONCE);

    const element = await RootLayout({ children: <span data-testid="child" /> });
    const { container } = render(element);

    expectInlineNodesToCarryNonce(container, NONCE);
    // The ordering guarantee the nonce attribute must not disturb.
    expect(container.firstElementChild?.tagName).toBe("SCRIPT");
  });

  it("stamps the staff shell's bootstrap script and brand style", async () => {
    mockRequestWithNonce(NONCE);
    // A non-401 failure (an outage) resolves to the product-preset fallback brand, which
    // is what this assertion needs: the point here is the nonce, not the brand payload.
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const element = await AppShellLayout({ children: <span data-testid="child" /> });
    const { container } = render(element);

    expectInlineNodesToCarryNonce(container, NONCE);
  });

  it("stamps the portal shell's bootstrap script and brand style", async () => {
    mockRequestWithNonce(NONCE);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          productDisplayName: activeProductPreset.productName,
          displayName: "Acme",
        }),
    });

    const element = await PortalLayout({
      children: <span data-testid="child" />,
      params: { slug: "acme-clinic" },
    });
    const { container } = render(element);

    expectInlineNodesToCarryNonce(container, NONCE);
  });

  it("renders no nonce attribute rather than an empty one when the request has none", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    vi.mocked(cookies).mockResolvedValue({ toString: () => "" } as never);

    const element = await RootLayout({ children: <span data-testid="child" /> });
    const { container } = render(element);

    // `nonce=""` would be a value the policy cannot match; absent is honest.
    for (const node of container.querySelectorAll("script, style")) {
      expect(node.hasAttribute("nonce")).toBe(false);
    }
  });
});

describe("readCspNonce", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the forwarded nonce", async () => {
    mockRequestWithNonce(NONCE);

    await expect(readCspNonce()).resolves.toBe(NONCE);
  });

  it("degrades to undefined instead of throwing outside a request scope", async () => {
    // A layout helper must never fail a render: a missing nonce costs the branding
    // script, while a thrown error costs the page.
    vi.mocked(headers).mockRejectedValue(new Error("headers was called outside a request scope"));

    await expect(readCspNonce()).resolves.toBeUndefined();
  });

  it("treats an empty forwarded nonce as absent", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-nonce": "" }));

    await expect(readCspNonce()).resolves.toBeUndefined();
  });
});
