import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MIN_PASSWORD_LENGTH, PortalResetPasswordForm } from "./portal-reset-password-form";

const TOKEN = "a-recovery-token";

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

function fill(password: string, confirmation = password): void {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Repeat it"), { target: { value: confirmation } });
}

afterEach(() => vi.restoreAllMocks());

describe("the portal reset form", () => {
  it("asks for the link when there is no token, and offers no field", () => {
    render(<PortalResetPasswordForm tenantSlug="acme" token="" />);
    expect(screen.getByTestId("portal-reset-no-token")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("posts the token WITHOUT a tenant, because the token is the authority", async () => {
    const fetchMock = installFetch(() => jsonResponse({ status: "reset" }));
    render(<PortalResetPasswordForm tenantSlug="acme" token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await screen.findByTestId("portal-reset-done");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/portal/password-reset");
    // Narrowed rather than stringified: `String(unknown)` would render an object as
    // `[object Object]`, which is an assertion that checks nothing.
    expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toEqual({
      token: TOKEN,
      password: "a-long-enough-password",
    });
  });

  it("mirrors the policy's minimum and refuses a mismatch the API cannot see", () => {
    render(<PortalResetPasswordForm tenantSlug="acme" token={TOKEN} />);
    const submit = screen.getByRole("button", { name: "Change password" });
    expect(submit).toBeDisabled();

    fill("x".repeat(MIN_PASSWORD_LENGTH - 1));
    expect(screen.getByTestId("portal-reset-too-short")).toBeInTheDocument();

    fill("a-long-enough-password", "a-different-one");
    expect(screen.getByTestId("portal-reset-mismatch")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fill("a-long-enough-password");
    expect(submit).toBeEnabled();
  });

  it("shows the API's OWN message for an unusable link, with no extra distinction", async () => {
    installFetch(() =>
      jsonResponse(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "This password reset link is not valid. Request a new one.",
          },
        },
        401
      )
    );
    render(<PortalResetPasswordForm tenantSlug="acme" token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    const problem = await screen.findByTestId("portal-reset-problem");
    expect(problem.textContent).toBe("This password reset link is not valid. Request a new one.");
    // No second, louder oracle: the UI does not guess whether the link was unknown, spent or expired.
    expect(problem.textContent).not.toMatch(/expired|already used|unknown/i);
    expect(screen.queryByTestId("portal-reset-done")).not.toBeInTheDocument();
  });

  it("says every session ended, and clears the password from state", async () => {
    installFetch(() => jsonResponse({ status: "reset" }));
    render(<PortalResetPasswordForm tenantSlug="acme" token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    const done = await screen.findByTestId("portal-reset-done");
    expect(done.textContent).toContain("every session");
    // A form that keeps a password is a form that can leak one.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/acme/login"
    );
  });
});
