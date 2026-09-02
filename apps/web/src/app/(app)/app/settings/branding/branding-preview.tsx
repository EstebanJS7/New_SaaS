"use client";

import type { JSX } from "react";
import { activeProductPreset, resolveBrand } from "@newsaas/ui/branding";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@newsaas/ui/components/ui/card";

interface BrandingPreviewProps {
  readonly primary: string;
  readonly accent: string;
  readonly radius: string;
}

/**
 * Bounded sample-card preview for branding edits.
 *
 * The preview consumes only the local form state; it never mutates the shell
 * layout and never persists anything. Colors and radius are applied inline to
 * sample surfaces so the preview stays self-contained and bounded.
 */
export function BrandingPreview({ primary, accent, radius }: BrandingPreviewProps): JSX.Element {
  const brand = resolveBrand(
    activeProductPreset,
    undefined,
    primary.trim().length > 0 || accent.trim().length > 0 || radius.trim().length > 0
      ? {
          schemaVersion: 1,
          ...(primary.trim().length > 0 ? { primary: primary.trim() } : {}),
          ...(accent.trim().length > 0 ? { accent: accent.trim() } : {}),
          ...(radius.trim().length > 0 ? { radius: radius.trim() } : {}),
        }
      : undefined
  );

  return (
    <Card className="max-w-xl" style={{ borderRadius: brand.theme.radius }}>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>
          This sample card reflects your local changes only. The rest of the shell updates after you
          save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="p-4 text-sm font-medium"
          style={{
            backgroundColor: brand.theme.colors.primary,
            color: brand.theme.colors["primary-foreground"],
            borderRadius: brand.theme.radius,
          }}
        >
          Primary surface
        </div>
        <div
          className="p-4 text-sm font-medium"
          style={{
            backgroundColor: brand.theme.colors.accent,
            color: brand.theme.colors["accent-foreground"],
            borderRadius: brand.theme.radius,
          }}
        >
          Accent surface
        </div>
      </CardContent>
    </Card>
  );
}
