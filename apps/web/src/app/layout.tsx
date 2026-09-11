import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { activeProductPreset, resolveBrand, type DefaultAppearance } from "@newsaas/ui/branding";
import { QueryProvider } from "@/providers/query-provider";
import { appearanceBootstrapScriptWithTenantDefault } from "@/lib/appearance";
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

const DEFAULT_API_URL = "http://localhost:3001";

/**
 * Resolves the tenant `defaultAppearance` at the document root so the
 * tenant-aware bootstrap can run as the first body child, before the preset
 * `<style>` and every paint-affecting node.
 *
 * This is the public, non-secret appearance layer only:
 * - portal requests resolve by the `x-tenant-slug` header (set by the edge /
 *   middleware from the portal path), never by a client-supplied tenant id;
 * - staff requests forward the session cookie to the private branding endpoint.
 *
 * Any missing signal or failure falls back to `undefined`, which the bootstrap
 * already resolves as local > OS > Core light. This keeps first paint correct
 * without weakening staff authorization (the private read still requires the
 * session cookie).
 */
async function resolveRootDefaultAppearance(): Promise<DefaultAppearance | undefined> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;

  try {
    const headerStore = await headers();
    // Middleware owns the provenance: it overwrites this header for every
    // request, forwarding an empty value on staff/root/reserved paths. Treat
    // any empty or whitespace-only value as "no tenant signal" so a client
    // header can never influence the root first paint.
    const slug = headerStore.get("x-tenant-slug")?.trim();

    if (slug) {
      const response = await fetch(
        `${apiUrl}/api/v1/public/tenants/${encodeURIComponent(slug)}/branding`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        return undefined;
      }
      const dto = (await response.json()) as { defaultAppearance?: DefaultAppearance };
      return dto.defaultAppearance;
    }

    const cookieStore = await cookies();
    const cookie = cookieStore.toString();
    if (cookie.length === 0) {
      return undefined;
    }

    const response = await fetch(`${apiUrl}/branding/current`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as {
      brand?: { defaultAppearance?: DefaultAppearance };
    };
    return data.brand?.defaultAppearance;
  } catch {
    return undefined;
  }
}

/**
 * Root layout.
 *
 * First body child is a parser-blocking, tenant-aware inline bootstrap script:
 * it reads the stored appearance, falls back to the tenant default, then the OS
 * preference, and adds the `dark` class to `<html>` before first paint, so there
 * is no flash. Because it is emitted here — before the preset `<style>` bridge
 * and every paint-affecting node in the streamed tree — no nested (late)
 * segment can paint a stale appearance first.
 *
 * The `<style>` bridge ships the resolved product preset under
 * `:root:not(.dark)` (D2); tenant layouts layer their brand `<style>` over it.
 * Its precedence comes from the selector, not tag order.
 *
 * `suppressHydrationWarning` on `<html>` is required because that pre-paint
 * class mutation makes server HTML differ from the hydrated DOM.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const defaultAppearance = await resolveRootDefaultAppearance();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        {/* Tenant-aware pre-paint bootstrap (D6/D8); source owned by lib/appearance.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: appearanceBootstrapScriptWithTenantDefault(defaultAppearance),
          }}
        />
        {/* Static, schema-validated preset CSS variable declarations (D1/D2/D4). */}
        <style dangerouslySetInnerHTML={{ __html: brandStyleCss(brand) }} />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
