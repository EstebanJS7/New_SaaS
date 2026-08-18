import type { ReactNode } from "react";
import { BrandProvider } from "@/providers/brand-provider";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

export const metadata = {
  title: "NewSaaS",
  description: "Multi-tenant SaaS foundation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <QueryProvider>
          <BrandProvider>{children}</BrandProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
