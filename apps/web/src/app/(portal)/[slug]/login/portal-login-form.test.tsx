import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

import { PortalLoginForm } from "./portal-login-form";

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

function fill(email = "cliente@example.test", password = "a-password"): void {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

afterEach(() => {
  vi.restoreAllMocks();
  replace.mockClear();
  refresh.mockClear();
});

describe("the portal sign-in form", () => {
  it("sends the tenant from the PATH and lands on /{slug}", async () => {
    const calls: { url: string; body: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({ portal: { portalAccessId: "pa-1" } });
    });
    render(<PortalLoginForm tenantSlug="acme" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/acme"));
    // The tenant is in the BODY because that is the API's contract, and it comes from the
    // route: the form never asks for it, so "wrong tenant" cannot be a typo the visitor made.
    expect(calls[0]?.url).toBe("/api/portal/login");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      tenantSlug: "acme",
      email: "cliente@example.test",
      password: "a-password",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the API's own refusal, adding no distinction", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } },
        401
      )
    );
    render(<PortalLoginForm tenantSlug="acme" />);
    fill("nobody@example.test", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const problem = await screen.findByTestId("portal-login-problem");
    expect(problem.textContent).toBe("Invalid email or password.");
    // The API answers ONE message for an unknown address, a wrong password and a wrong
    // tenant; a form that guessed would be a louder oracle than the API it fronts.
    expect(problem.textContent).not.toMatch(/tenant|unknown|not found/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears the password on failure and keeps the email", async () => {
    installFetch(() => jsonResponse({ error: { code: "UNAUTHENTICATED", message: "no" } }, 401));
    render(<PortalLoginForm tenantSlug="acme" />);
    fill("cliente@example.test", "a-secret");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const problem = await screen.findByTestId("portal-login-problem");
    expect(screen.getByLabelText<HTMLInputElement>("Password").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Email").value).toBe("cliente@example.test");
    expect(problem.textContent).not.toContain("a-secret");
  });

  it("offers the recovery link, in THAT clinic's path", () => {
    render(<PortalLoginForm tenantSlug="acme" />);
    // PORTAL-001 deliberately omitted this link because there was no portal flow to point it at, and
    // this case asserted its ABSENCE — a test that encoded the gap. PORTAL-002 built the flow, and the
    // href carries the slug because the recovery page has to know which clinic the holder is at.
    expect(screen.getByTestId("portal-login-forgot-password")).toHaveAttribute(
      "href",
      "/acme/forgot-password"
    );
  });

  it("cannot submit without both fields", () => {
    render(<PortalLoginForm tenantSlug="acme" />);
    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).toBeDisabled();
    fill();
    expect(submit).toBeEnabled();
  });
});
