import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MIN_PASSWORD_LENGTH, ResetPasswordForm } from "./reset-password-form";

const TOKEN = "a-recovery-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function installFetch(handler: (url: string, init?: RequestInit) => Response): void {
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(resolveUrl(input), init))
  );
}

function fill(password: string, confirmation = password): void {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Repeat it"), { target: { value: confirmation } });
}

afterEach(() => vi.restoreAllMocks());

describe("the reset form", () => {
  it("asks for the link when there is no token, and offers no field", () => {
    render(<ResetPasswordForm token="" />);
    expect(screen.getByTestId("reset-no-token")).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("mirrors the policy's minimum length before submitting", () => {
    render(<ResetPasswordForm token={TOKEN} />);
    const submit = screen.getByRole("button", { name: "Change password" });
    expect(submit).toBeDisabled();

    fill("x".repeat(MIN_PASSWORD_LENGTH - 1));
    expect(screen.getByTestId("reset-too-short")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fill("x".repeat(MIN_PASSWORD_LENGTH));
    expect(screen.queryByTestId("reset-too-short")).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it("refuses a mismatch, which the API cannot see", () => {
    render(<ResetPasswordForm token={TOKEN} />);
    // Confirmation is a UI concern: the API receives one password and has nothing to
    // compare it with.
    fill("a-long-enough-password", "a-different-one");
    expect(screen.getByTestId("reset-mismatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
  });

  it("posts the token and the password, then says every session ended", async () => {
    const calls: { url: string; body: string }[] = [];
    installFetch((url, init) => {
      // Narrowed rather than stringified: `String(unknown)` would render an object as
      // `[object Object]`, which is a test that silently asserts nothing.
      calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({ status: "reset" });
    });
    render(<ResetPasswordForm token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByTestId("reset-done")).toBeInTheDocument();
    // The message says what actually happened: the reset ends EVERY session, so a user
    // who is signed in elsewhere is told rather than surprised.
    expect(screen.getByTestId("reset-done").textContent).toContain("every session");
    expect(calls[0]?.url).toBe("/api/auth/password-reset");
    expect(calls[0]?.body).toContain(TOKEN);
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
    render(<ResetPasswordForm token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    const problem = await screen.findByTestId("reset-problem");
    expect(problem.textContent).toBe("This password reset link is not valid. Request a new one.");
    // No second, louder oracle: the UI does not guess whether the link was unknown, spent
    // or expired, because the API deliberately does not distinguish them either.
    expect(problem.textContent).not.toMatch(/expired|already used|unknown/i);
  });

  it("stays on the form after a refusal, so the user is not told it worked", async () => {
    installFetch(() => jsonResponse({ error: { code: "UNAUTHENTICATED", message: "no" } }, 401));
    render(<ResetPasswordForm token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await screen.findByTestId("reset-problem");
    expect(screen.queryByTestId("reset-done")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("clears the password from state once it is sent", async () => {
    installFetch(() => jsonResponse({ status: "reset" }));
    render(<ResetPasswordForm token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await screen.findByTestId("reset-done");
    // The success view holds no password: a form that keeps one is a form that can leak
    // one, and it has no further use for it.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("shows a generic failure for a non-API error, never the error object", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    render(<ResetPasswordForm token={TOKEN} />);
    fill("a-long-enough-password");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(screen.getByTestId("reset-problem").textContent).toBe(
        "Something went wrong. Try the link again."
      )
    );
    expect(screen.getByTestId("reset-problem").textContent).not.toContain("network down");
  });
});
