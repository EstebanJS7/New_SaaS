/**
 * Forward-declared branding theme type.
 *
 * Resolution (Core → Product → Tenant) is intentionally deferred to EPIC-03.
 * EPIC-00 only ships the neutral defaults and a validating schema.
 */
export interface BrandTheme {
  /** Semantic color tokens. */
  colors: {
    background: string;
    foreground: string;
    card: string;
    "card-foreground": string;
    primary: string;
    "primary-foreground": string;
    secondary: string;
    "secondary-foreground": string;
    muted: string;
    "muted-foreground": string;
    accent: string;
    "accent-foreground": string;
    destructive: string;
    "destructive-foreground": string;
    status: {
      success: string;
      error: string;
    };
    border: string;
    input: string;
    ring: string;
  };
  /** Border radius in rem. */
  radius: string;
  /** Approved font family stacks. */
  fonts: {
    sans: string;
    mono: string;
  };
}
