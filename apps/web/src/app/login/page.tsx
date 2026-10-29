import type { JSX } from "react";
import { LoginForm } from "./login-form";
import { activeProductPreset } from "@newsaas/ui/branding";
import { Icon } from "@newsaas/ui/components/ui/icon";

/**
 * The staff sign-in page ([[SHEL-001]]) — the app's front door, and the reason this Story
 * exists: until it, nobody could establish a session from a browser, because the session
 * cookie is `HttpOnly` and no page set it.
 *
 * It is outside the `(app)` route group, which is the shell that fetches tenant-scoped data
 * from a session a visitor does not have yet. It renders under the ROOT layout, so it still
 * carries the product's resolved brand — the same public layer a signed-out surface is
 * allowed to see, and no tenant-scoped read.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string | string[]; reason?: string }>;
} = {}): Promise<JSX.Element> {
  const params = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section
        className="workspace-sidebar relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16"
        aria-label="Presentación del producto"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Icon name="activity" className="size-6" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            {activeProductPreset.productName}
          </span>
        </div>
        <div className="relative max-w-lg py-20">
          <p className="mb-6 text-xs font-medium uppercase tracking-[0.2em] text-sidebar-muted">
            Tu trabajo diario, conectado
          </p>
          <h1 className="text-5xl font-semibold leading-[1.1] tracking-tight xl:text-6xl">
            Menos obstáculos.
            <br />
            Más atención.
          </h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-sidebar-foreground/65">
            Las personas, las fichas y las operaciones de tu equipo, en un mismo espacio de trabajo.
          </p>
          <div className="mt-12 grid max-w-sm grid-cols-3 gap-4 border-t border-sidebar-foreground/15 pt-6">
            {(["Organizá", "Colaborá", "Crecé"] as const).map((label) => (
              <div key={label}>
                <Icon name="check" className="mb-3 text-sidebar-muted" />
                <span className="text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-sidebar-foreground/45">
          Diseñado para la forma de trabajar de tu equipo.
        </p>
      </section>
      <section className="flex flex-col items-center justify-center bg-background px-6 py-12 sm:px-10">
        <div className="mb-10 flex items-center gap-2 text-sm font-semibold lg:hidden">
          <Icon name="activity" className="text-primary" />
          {activeProductPreset.productName}
        </div>
        <div className="w-full max-w-sm">
          <LoginForm
            returnTo={typeof params?.returnTo === "string" ? params.returnTo : undefined}
            expired={params?.reason === "session-expired"}
          />
          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            Ingresá con la cuenta proporcionada por tu organización.
            <br />
            ¿Necesitás ayuda? Contactá con quien administra tu espacio de trabajo.
          </p>
        </div>
      </section>
    </main>
  );
}
