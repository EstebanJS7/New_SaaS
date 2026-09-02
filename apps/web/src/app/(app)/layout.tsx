import type { JSX, ReactNode } from "react";
import { cookies } from "next/headers";
import { activeProductPreset, resolveBrand, type ResolvedBrand } from "@newsaas/ui/branding";
import { NavSidebar } from "@/components/shell/nav-sidebar";
import { Topbar } from "@/components/shell/topbar";
import { appearanceBootstrapScriptWithDefault } from "@/lib/appearance";
import { brandStyleCss } from "@/lib/brand-style";

const DEFAULT_API_URL = "http://localhost:3001";

interface BrandingCurrentResponse {
  readonly source: "tenant" | "preset";
  readonly brand: ResolvedBrand;
}

async function fetchResolvedBrand(): Promise<ResolvedBrand> {
  try {
    const cookieStore = await cookies();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
    const response = await fetch(`${apiUrl}/branding/current`, {
      headers: { cookie: cookieStore?.toString() ?? "" },
      cache: "no-store",
    });

    if (!response.ok) {
      return resolveBrand(activeProductPreset);
    }

    const data = (await response.json()) as BrandingCurrentResponse;
    return data.brand ?? resolveBrand(activeProductPreset);
  } catch {
    return resolveBrand(activeProductPreset);
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
 */
export default async function AppShellLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const brand = await fetchResolvedBrand();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <script
        dangerouslySetInnerHTML={{
          __html: appearanceBootstrapScriptWithDefault(brand.defaultAppearance),
        }}
      />
      <style dangerouslySetInnerHTML={{ __html: brandStyleCss(brand) }} />
      <NavSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Identity resolved here on the server; components stay preset-agnostic. */}
        <Topbar productName={activeProductPreset.productName} />
        <main data-shell-content className="min-w-0 flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
