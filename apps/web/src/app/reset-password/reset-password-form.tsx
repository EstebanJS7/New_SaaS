"use client";

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@newsaas/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";
import { ApiRequestError, resetPassword } from "./reset-password-api";

/**
 * The reset form ([[TD-048]]).
 *
 * The stable API code maps to one translated refusal for an unusable link: one message for
 * unknown, spent and expired alike, because the API deliberately does not distinguish
 * them and a UI that invented a distinction would be a **louder oracle** than the API it
 * fronts. So there is no "this link expired" branch — there is "this link is not valid",
 * which is true for all three.
 *
 * The minimum length mirrors the credential boundary's policy. It is a convenience, not
 * the rule: the API refuses a short password whether or not the browser does, and this
 * form would still submit if the check were removed.
 */
export const MIN_PASSWORD_LENGTH = 8;

type Status = "idle" | "submitting" | "done";

interface ResetPasswordFormProps {
  readonly token: string;
  /**
   * ONB-001: the link came from an INVITATION (`&activate=1`), so the person is choosing a
   * first password rather than replacing one. Only the words change: the token is the
   * same kind, the API call is the same, and the server decides what the token allows.
   */
  readonly activation?: boolean;
}

const COPY = {
  reset: {
    title: "Restablecé tu contraseña",
    description: "Elegí una nueva contraseña para tu cuenta.",
    noTokenDescription: "Necesitás el enlace que recibiste por correo.",
    noToken: "Abrí el enlace del mensaje de recuperación. Si ya no es válido, solicitá uno nuevo.",
    invalidLink: "El enlace no es válido. Solicitá uno nuevo.",
    failure: "No se pudo actualizar la contraseña. Intentá nuevamente.",
    doneTitle: "Contraseña actualizada",
    done: "Tu contraseña se actualizó y se cerraron todas las sesiones en tus dispositivos. Ingresá nuevamente con tu nueva contraseña.",
    submit: "Actualizar contraseña",
    submitting: "Actualizando…",
  },
  activate: {
    title: "Activá tu cuenta",
    description: "Elegí la contraseña con la que vas a ingresar.",
    noTokenDescription: "Necesitás el enlace de la invitación que recibiste por correo.",
    noToken:
      "Abrí el enlace del mensaje de invitación. Si ya venció, pedí uno nuevo desde «¿Olvidaste tu contraseña?».",
    invalidLink:
      "El enlace no es válido o ya venció. Pedí uno nuevo desde «¿Olvidaste tu contraseña?» o a quien te invitó.",
    failure: "No se pudo activar la cuenta. Intentá nuevamente.",
    doneTitle: "Cuenta activada",
    done: "Ya podés ingresar con tu email y la contraseña que elegiste.",
    submit: "Activar cuenta",
    submitting: "Activando…",
  },
} as const;

export function ResetPasswordForm({
  token,
  activation = false,
}: ResetPasswordFormProps): JSX.Element {
  const copy = activation ? COPY.activate : COPY.reset;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const canSubmit =
    token.length > 0 && password.length >= MIN_PASSWORD_LENGTH && confirmation === password;

  async function submit(): Promise<void> {
    setProblem(null);
    setStatus("submitting");
    try {
      await resetPassword({ token, password });
      // The password is cleared from state the moment it is sent: it has no further use
      // here, and a form that keeps it is a form that can leak it.
      setPassword("");
      setConfirmation("");
      setStatus("done");
    } catch (error) {
      setStatus("idle");
      setProblem(
        error instanceof ApiRequestError && error.code === "UNAUTHENTICATED"
          ? copy.invalidLink
          : copy.failure
      );
    }
  }

  if (token.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{copy.title}</h1>
          </CardTitle>
          <CardDescription>{copy.noTokenDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <p data-testid="reset-no-token" className="text-sm text-muted-foreground">
            {copy.noToken}
          </p>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Volver al inicio de sesión
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (status === "done") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{copy.doneTitle}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="status" data-testid="reset-done" className="text-sm text-muted-foreground">
            {copy.done}
          </p>
          <Link href="/login" className="text-sm underline underline-offset-4">
            {activation ? "Ingresar" : "Volver al inicio de sesión"}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{copy.title}</h1>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          A real `<form>`: the same defect the lane found on the two sign-in surfaces, and the same
          fix. With the fields in a plain container and the button as `type="submit"`, Enter did
          nothing — and a recovery form is exactly where a password manager fills and submits.
        */}
        <form
          aria-busy={status === "submitting"}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="reset-password" className="text-sm font-medium">
              {activation ? "Contraseña" : "Nueva contraseña"}
            </label>
            <input
              id="reset-password"
              aria-invalid={tooShort}
              aria-describedby={tooShort ? "reset-too-short" : undefined}
              disabled={status === "submitting"}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {tooShort ? (
              <p
                id="reset-too-short"
                data-testid="reset-too-short"
                className="text-sm text-destructive"
              >
                {`Usá al menos ${MIN_PASSWORD_LENGTH} caracteres.`}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="reset-confirmation" className="text-sm font-medium">
              Repetí la contraseña
            </label>
            <input
              id="reset-confirmation"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "reset-mismatch" : undefined}
              disabled={status === "submitting"}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {mismatch ? (
              <p
                id="reset-mismatch"
                data-testid="reset-mismatch"
                className="text-sm text-destructive"
              >
                Las contraseñas no coinciden.
              </p>
            ) : null}
          </div>
          {problem === null ? null : (
            <p
              role="alert"
              id="reset-problem"
              data-testid="reset-problem"
              className="text-sm text-destructive"
            >
              {problem}
            </p>
          )}
          <Button type="submit" disabled={!canSubmit || status === "submitting"}>
            {status === "submitting" ? copy.submitting : copy.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
