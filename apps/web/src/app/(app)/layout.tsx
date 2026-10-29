import type { JSX, ReactNode } from "react";
import { staffSignInPath } from "@/lib/staff-return-path";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { activeProductPreset, resolveBrand, type ResolvedBrand } from "@newsaas/ui/branding";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { BrandStyle } from "@/providers/document-nonce";
import { appearanceBootstrapScriptWithTenantDefault } from "@/lib/appearance";
import { readCspNonce } from "@/lib/csp-nonce";
import { brandStyleCss } from "@/lib/brand-style";

const DEFAULT_API_URL = "http://localhost:3001";

interface BrandingCurrentResponse {
  readonly source: "tenant" | "preset";
  readonly brand: ResolvedBrand;
}

interface BrandResolution {
  readonly brand: ResolvedBrand;
  /**
   * True only when the API answered `401`.
   *
   * The asymmetry is the design, not a detail: `/branding/current` is a PRIVATE route, so a
   * 401 is the ONLY thing that proves this visitor has no session. Every other failure — a
   * 500, a timeout, an unparseable body — is an OUTAGE, and treating it as "signed out"
   * would send every signed-in staff member to the login page the moment branding has a bad
   * minute ([[SHELL-001]]).
   */
  readonly unauthenticated: boolean;
}

async function fetchResolvedBrand(): Promise<BrandResolution> {
  const fallback = resolveBrand(activeProductPreset);
  try {
    const cookieStore = await cookies();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
    const response = await fetch(`${apiUrl}/branding/current`, {
      headers: { cookie: cookieStore?.toString() ?? "" },
      cache: "no-store",
    });

    if (response.status === 401) {
      return { brand: fallback, unauthenticated: true };
    }
    if (!response.ok) {
      return { brand: fallback, unauthenticated: false };
    }

    const data = (await response.json()) as BrandingCurrentResponse;
    return { brand: data.brand ?? fallback, unauthenticated: false };
  } catch {
    return { brand: fallback, unauthenticated: false };
  }
}

/**
 * Staff shell layout for the `/app` route group.
 *
 * Plain `<aside>` + `<header>` + `<main>` composition per design D8. Every
 * route inside the group — including deep links — renders within this chrome.
 * `<main data-shell-content>` is the bounded content region that hosts
 * self-contained sample cards inheriting the resolved brand tokens.
 *
 * Branding is resolved server-side from the private API (cookies forwarded)
 * and emitted as a parser-blocking bootstrap script plus a `<style>` bridge
 * under `:root:not(.dark)` (design D4/D5).
 *
 * **It is also the shell's gate** ([[SHELL-001]]). That one private read answers two
 * questions with one request — what this tenant's brand is, and whether there is a session
 * at all — and a `401` sends the visitor to `/login`. Without it, a signed-out visitor was
 * shown an EMPTY SHELL: every surface inside renders from session-scoped data, so the shell
 * was chrome around nothing, and the visitor had no way to learn that signing in was the
 * missing step. The redirect is server-side, so the shell never renders first.
 */
export default async function AppShellLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const { brand, unauthenticated } = await fetchResolvedBrand();
  // Per-request CSP nonce ([[DEC-075]]); see lib/csp.ts for why inline nodes here
  // cannot be replaced by external stylesheets or scripts.
  const nonce = await readCspNonce();
  // Called OUTSIDE the fetch's `try`: `redirect` works by throwing, and a catch around it
  // would swallow the redirect and render the shell anyway.
  if (unauthenticated) {
    redirect(staffSignInPath((await headers()).get("x-staff-return-path")));
  }

  return (
    <div>
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: appearanceBootstrapScriptWithTenantDefault(brand.defaultAppearance),
        }}
      />
      <BrandStyle nonce={nonce} css={brandStyleCss(brand)} />
      <WorkspaceShell
        productName={activeProductPreset.productName}
        productLogoUrl={brand.assets?.logoLightUrl}
        defaultAppearance={brand.defaultAppearance}
      >
        {children}
      </WorkspaceShell>
    </div>
  );
}
