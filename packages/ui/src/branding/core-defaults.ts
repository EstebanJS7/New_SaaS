import type { BrandTheme } from "./types.js";

/**
 * Neutral CoreDesignDefaults.
 *
 * These semantic tokens are the bottom layer of the brand resolution stack.
 * Product presets and tenant overrides extend them, never replace them with
 * arbitrary CSS or JavaScript.
 */
export const coreDesignDefaults: BrandTheme = {
  colors: {
    background: "hsl(0 0% 100%)",
    foreground: "hsl(240 10% 3.9%)",
    card: "hsl(0 0% 100%)",
    "card-foreground": "hsl(240 10% 3.9%)",
    primary: "hsl(240 5.9% 10%)",
    "primary-foreground": "hsl(0 0% 98%)",
    secondary: "hsl(240 4.8% 95.9%)",
    "secondary-foreground": "hsl(240 5.9% 10%)",
    muted: "hsl(240 4.8% 95.9%)",
    "muted-foreground": "hsl(240 3.8% 46.1%)",
    accent: "hsl(240 4.8% 95.9%)",
    "accent-foreground": "hsl(240 5.9% 10%)",
    destructive: "hsl(0 84.2% 60.2%)",
    "destructive-foreground": "hsl(0 0% 98%)",
    status: {
      success: "hsl(142 76% 36%)",
      error: "hsl(0 84.2% 60.2%)",
    },
    border: "hsl(240 5.9% 90%)",
    input: "hsl(240 5.9% 90%)",
    ring: "hsl(240 5.9% 10%)",
  },
  radius: "0.5rem",
  fonts: {
    sans: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
};
