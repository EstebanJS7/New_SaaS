import type { ReactNode } from "react";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";
import { BrandProvider } from "@/providers/brand-provider";
import { QueryProvider } from "@/providers/query-provider";
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
 * The `<style>` bridge ships the resolved brand values in the first-paint
 * payload under `:root:not(.dark)` (D2), so there is no flash and no client
 * JS. `suppressHydrationWarning` on `<html>` is required because the
 * appearance bootstrap (EPIC-03 Unit 5) may add the `dark` class pre-paint.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        {/* Static, schema-validated CSS variable declarations (D1/D2/D4). */}
        <style dangerouslySetInnerHTML={{ __html: brandStyleCss(brand) }} />
        <QueryProvider>
          <BrandProvider brand={brand}>{children}</BrandProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
