import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PortalForgotPasswordForm } from "./portal-forgot-password-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init?: RequestInit) => Response
): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(
      handler(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        init
      )
    )
  );
  global.fetch = mock;
  return mock;
}

function submit(email = "holder@portal.test"): void {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send the link" }));
}

afterEach(() => vi.restoreAllMocks());

describe("the portal recovery request form", () => {
  it("sends the tenant from the PATH with the address", async () => {
    const fetchMock = installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<PortalForgotPasswordForm tenantSlug="acme" />);
    submit();

    await screen.findByTestId("portal-forgot-sent");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/forgot-password");
    // Narrowed rather than stringified: `String(unknown)` would render an object as
    // `[object Object]`, which is an assertion that checks nothing.
    expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toEqual({
      tenantSlug: "acme",
      email: "holder@portal.test",
    });
  });

  it("does NOT claim a message was sent, because the API cannot know", async () => {
    installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<PortalForgotPasswordForm tenantSlug="acme" />);
    submit("nobody@portal.test");

    const sent = await screen.findByTestId("portal-forgot-sent");
    // The API answers 202 identically for a holder, a stranger, an ambiguous identity and a holder
    // with no credential — a form claiming delivery would do the leaking the API avoids.
    expect(sent.textContent).toContain("If that address has an account");
    expect(sent.textContent).not.toMatch(/has been sent|we sent|check your inbox/i);
  });

  it("shows the API's rate limit as its own answer, and links back to THAT clinic", async () => {
    installFetch(() =>
      jsonResponse(
        {
          error: { code: "RATE_LIMITED", message: "Too many recovery requests. Try again later." },
        },
        429
      )
    );
    render(<PortalForgotPasswordForm tenantSlug="acme" />);
    submit();

    expect((await screen.findByTestId("portal-forgot-problem")).textContent).toContain(
      "Too many recovery requests"
    );
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/acme/login"
    );
  });

  it("cannot submit an empty address", () => {
    installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<PortalForgotPasswordForm tenantSlug="acme" />);
    expect(screen.getByRole("button", { name: "Send the link" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.test" } });
    expect(screen.getByRole("button", { name: "Send the link" })).toBeEnabled();
  });
});
