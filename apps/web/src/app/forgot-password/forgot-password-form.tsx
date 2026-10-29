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
import { ApiRequestError, requestPasswordReset } from "./forgot-password-api";

/**
 * The recovery REQUEST form ([[SHEL-001]]).
 *
 * The API answers `202` **identically** for an address that exists and one that does not, so
 * the success state must not claim a message was sent. It says what is true: if that address
 * has an account, a message is on its way. A form that said "sent" would be the enumeration
 * oracle the API is built to avoid, with the UI doing the leaking.
 */
export function ForgotPasswordForm(): JSX.Element {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setProblem(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      setProblem(
        error instanceof ApiRequestError && error.code === "RATE_LIMITED"
          ? "Hubo demasiadas solicitudes. Esperá unos minutos y volvé a intentar."
          : "No se pudo solicitar el enlace. Intentá nuevamente."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Revisá tu correo</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="status" data-testid="forgot-sent" className="text-sm text-muted-foreground">
            Si ese correo tiene una cuenta, recibirá un mensaje de recuperación. El enlace es válido
            durante treinta minutos.
          </p>
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Volver al inicio de sesión
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Recuperá tu contraseña</h1>
        </CardTitle>
        <CardDescription>Solicitá un enlace para elegir una nueva contraseña.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/*
          A real `<form>`: the same defect the lane found on the two sign-in surfaces, and the same
          fix. With the fields in a plain container and the button as `type="submit"`, Enter did
          nothing — and a recovery form is exactly where a password manager fills and submits.
        */}
        <form
          aria-busy={submitting}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="forgot-email" className="text-sm font-medium">
              Correo electrónico
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="username"
              required
              disabled={submitting}
              aria-describedby={problem ? "forgot-problem" : undefined}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {problem === null ? null : (
            <p
              role="alert"
              id="forgot-problem"
              data-testid="forgot-problem"
              className="text-sm text-destructive"
            >
              {problem}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <Button type="submit" disabled={email.trim().length === 0 || submitting}>
              {submitting ? "Enviando…" : "Enviar enlace"}
            </Button>
            <Link
              href="/login"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Volver al inicio de sesión
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
