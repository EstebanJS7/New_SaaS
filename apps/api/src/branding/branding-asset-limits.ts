/**
 * Branding-specific asset upload limits (bytes).
 *
 * These caps are branding policy, not a generic object-storage concern, so
 * they live in the branding boundary rather than the shared `@newsaas/storage`
 * platform package. The per-kind limits are enforced by `BrandingAssetPipe`;
 * the global Fastify multipart ceiling imports the largest one so an oversized
 * part is rejected before parsing.
 */
export const BRANDING_ASSET_LIMITS = Object.freeze({
  /** Logo variants: 2 MiB. */
  logo: 2_097_152,
  /** Favicon: 512 KiB. */
  favicon: 524_288,
});
