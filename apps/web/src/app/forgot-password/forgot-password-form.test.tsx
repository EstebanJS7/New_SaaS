import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ForgotPasswordForm } from "./forgot-password-form";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (url: string) => Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(
      handler(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    )
  );
  global.fetch = mock;
  return mock;
}

function submit(email = "staff@clinic.test"): void {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send the link" }));
}

afterEach(() => vi.restoreAllMocks());

describe("the recovery request form", () => {
  it("posts the address to the request route", async () => {
    const fetchMock = installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<ForgotPasswordForm />);
    submit();

    await screen.findByTestId("forgot-sent");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/forgot-password");
    expect(init.body).toBe(JSON.stringify({ email: "staff@clinic.test" }));
  });

  it("does NOT claim a message was sent, because the API cannot know", async () => {
    installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<ForgotPasswordForm />);
    submit("nobody@clinic.test");

    const sent = await screen.findByTestId("forgot-sent");
    // The API answers 202 identically for an address that exists and one that does not, so a
    // form saying "we sent it" would be the account-existence oracle the API is built to
    // avoid — with the UI doing the leaking.
    expect(sent.textContent).toContain("If that address has an account");
    expect(sent.textContent).not.toMatch(/has been sent|we sent|check your inbox/i);
  });

  it("shows the API's rate limit as its own answer", async () => {
    installFetch(() =>
      jsonResponse(
        {
          error: { code: "RATE_LIMITED", message: "Too many recovery requests. Try again later." },
        },
        429
      )
    );
    render(<ForgotPasswordForm />);
    submit();

    expect((await screen.findByTestId("forgot-problem")).textContent).toContain(
      "Too many recovery requests"
    );
  });

  it("stays on the form after a failure", async () => {
    installFetch(() => jsonResponse({ error: { code: "RATE_LIMITED", message: "no" } }, 429));
    render(<ForgotPasswordForm />);
    submit();

    await screen.findByTestId("forgot-problem");
    expect(screen.queryByTestId("forgot-sent")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("links back to sign in from both states", async () => {
    installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<ForgotPasswordForm />);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");

    submit();
    await screen.findByTestId("forgot-sent");
    // The success state offers the way back too: the user's next move is signing in with the
    // password the message will let them set.
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("cannot submit an empty address", () => {
    installFetch(() => jsonResponse({ status: "accepted" }, 202));
    render(<ForgotPasswordForm />);
    expect(screen.getByRole("button", { name: "Send the link" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.test" } });
    expect(screen.getByRole("button", { name: "Send the link" })).toBeEnabled();
  });
});
