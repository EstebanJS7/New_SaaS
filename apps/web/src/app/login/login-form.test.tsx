import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("./navigation", () => ({
  navigateAfterSignIn: (target?: string): void => {
    navigate(target);
  },
}));

import { LoginForm } from "./login-form";

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

function fill(email = "staff@clinic.test", password = "a-password"): void {
  fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } });
}

afterEach(() => {
  vi.restoreAllMocks();
  navigate.mockClear();
});

describe("the sign-in form", () => {
  it("posts the credentials and lands on /app", async () => {
    const calls: { url: string; body: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({ user: { id: "u1" } });
    });
    render(<LoginForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    // Full document navigation re-establishes both the session and CSP/brand styles.
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(calls[0]?.url).toBe("/api/auth/login");
    expect(calls[0]?.body).toContain("a-password");
  });

  it("translates bad credentials without distinguishing account existence", async () => {
    installFetch(() =>
      jsonResponse(
        { error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } },
        401
      )
    );
    render(<LoginForm />);
    fill("nobody@clinic.test", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const problem = await screen.findByTestId("login-problem");
    expect(problem.textContent).toBe("El correo o la contraseña no son correctos.");
    expect(problem).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Correo electrónico")).toHaveAccessibleDescription(
      problem.textContent ?? ""
    );
    expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription(
      problem.textContent ?? ""
    );
    // The API answers ONE message for an unknown address and a wrong password; a form that
    // guessed which was which would be a louder oracle than the API it fronts.
    expect(problem.textContent).not.toMatch(/unknown|no such|not found/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("surfaces the rate limit as its own answer", async () => {
    installFetch(() =>
      jsonResponse(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many failed login attempts. Try again later.",
          },
        },
        429
      )
    );
    render(<LoginForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect((await screen.findByTestId("login-problem")).textContent).toContain(
      "Hubo demasiados intentos"
    );
  });

  it("clears the password on failure and never puts it in the message", async () => {
    installFetch(() => jsonResponse({ error: { code: "UNAUTHENTICATED", message: "no" } }, 401));
    render(<LoginForm />);
    fill("staff@clinic.test", "a-secret-password");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const problem = await screen.findByTestId("login-problem");
    // `getByLabelText<HTMLInputElement>`: the generic is what makes `.value` readable
    // without a cast the lint rejects.
    // A password left in the field after a refusal is a password on a shared screen.
    expect(screen.getByLabelText<HTMLInputElement>("Contraseña").value).toBe("");
    // And the email survives, which is the half the user would have to retype.
    expect(screen.getByLabelText<HTMLInputElement>("Correo electrónico").value).toBe(
      "staff@clinic.test"
    );
    expect(problem.textContent).not.toContain("a-secret-password");
  });

  it("shows a generic failure for a non-API error, never the error object", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    render(<LoginForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const problem = await screen.findByTestId("login-problem");
    expect(problem.textContent).toBe("No se pudo iniciar sesión. Intentá de nuevo.");
    expect(problem.textContent).not.toContain("network down");
  });

  it("offers the recovery entry point, which is what DAT-007 was missing", () => {
    render(<LoginForm />);
    // The link is the whole reason a user can REQUEST a recovery at all: /reset-password is
    // where a link lands, and before this there was no page that asked for one.
    expect(screen.getByTestId("login-forgot-password")).toHaveAttribute("href", "/forgot-password");
  });

  it("cannot submit without both fields", () => {
    render(<LoginForm />);
    const submit = screen.getByRole("button", { name: "Iniciar sesión" });
    expect(submit).toBeDisabled();
    fill("staff@clinic.test", "");
    expect(submit).toBeDisabled();
    fill("", "a-password");
    expect(submit).toBeDisabled();
    fill();
    expect(submit).toBeEnabled();
  });
  it("explains expiry and passes the saved destination only after successful authentication", async () => {
    navigate.mockClear();
    installFetch(() => jsonResponse({}));
    render(<LoginForm returnTo="/app/agenda" expired />);
    expect(screen.getByRole("status")).toHaveTextContent("Los cambios sin guardar");
    expect(navigate).not.toHaveBeenCalled();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/agenda"));
  });
});
