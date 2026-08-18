import { z } from "zod";

/**
 * Zod schema for validating a BrandTheme override.
 *
 * Rejects arbitrary CSS/JS by constraining values to approved shapes:
 * - colors must be HSL() or hex strings;
 * - radius must be a positive rem value;
 * - fonts must use only approved font-family names.
 */
const hslOrHex = z
  .string()
  .regex(
    /^(hsl\(\s*\d+\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%\s*\)|#[0-9a-fA-F]{6})$/,
    "Color must be an hsl() or 6-digit hex value"
  );

const remValue = z
  .string()
  .regex(/^\d+(?:\.\d+)?rem$/, "Radius must be a positive rem value (e.g. 0.5rem)");

export const APPROVED_FONT_FAMILIES = [
  "Inter",
  "Roboto",
  "system-ui",
  "ui-sans-serif",
  "ui-monospace",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Helvetica Neue",
  "Arial",
  "Noto Sans",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  "monospace",
  "sans-serif",
  "serif",
] as const;

const fontStack = z.string().refine((value) => {
  const families = value
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const approved = APPROVED_FONT_FAMILIES as readonly string[];
  return families.length > 0 && families.every((family) => approved.includes(family));
}, "Font stack must contain only approved font-family names");

export const brandThemeSchema = z.object({
  colors: z.object({
    background: hslOrHex,
    foreground: hslOrHex,
    card: hslOrHex,
    "card-foreground": hslOrHex,
    primary: hslOrHex,
    "primary-foreground": hslOrHex,
    secondary: hslOrHex,
    "secondary-foreground": hslOrHex,
    muted: hslOrHex,
    "muted-foreground": hslOrHex,
    accent: hslOrHex,
    "accent-foreground": hslOrHex,
    destructive: hslOrHex,
    "destructive-foreground": hslOrHex,
    status: z.object({
      success: hslOrHex,
      error: hslOrHex,
    }),
    border: hslOrHex,
    input: hslOrHex,
    ring: hslOrHex,
  }),
  radius: remValue,
  fonts: z.object({
    sans: fontStack,
    mono: fontStack,
  }),
});
