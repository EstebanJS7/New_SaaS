import type { ReactNode } from "react";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";
import { QueryProvider } from "@/providers/query-provider";
import { appearanceBootstrapScript } from "@/lib/appearance";
import { brandStyleCss } from "@/lib/brand-style";
import "./globals.css";

export const metadata = {
  title: "NewSaaS",
  description: "Multi-tenant SaaS foundation",
};

/**
 * Server-resolved brand for the active product preset (design D4).
 *
 * Pure data merge over static preset files: no I/O, evaluated once per server
 * render. Phase B tenant overrides plug in as an extra resolver layer here,
 * without touching any component.
 */
const brand = resolveBrand(activeProductPreset);

/**
 * Root layout.
 *
 * First body child is a parser-blocking inline bootstrap script (D6): it
 * reads the stored appearance and adds the `dark` class to `<html>` before
 * first paint, so there is no flash. The `<style>` bridge then ships the
 * resolved brand values under `:root:not(.dark)` (D2) — its precedence comes
 * from the selector, not tag order, so script-before-style is safe.
 *
 * `suppressHydrationWarning` on `<html>` is required because that pre-paint
 * class mutation makes server HTML differ from the hydrated DOM.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        {/* Pre-paint appearance bootstrap (D6); static string, see lib/appearance.ts. */}
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrapScript }} />
        {/* Static, schema-validated CSS variable declarations (D1/D2/D4). */}
        <style dangerouslySetInnerHTML={{ __html: brandStyleCss(brand) }} />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
