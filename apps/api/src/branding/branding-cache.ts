/**
 * In-memory branding cache keyed by tenant + revision token.
 *
 * The revision token is recomputed on every tenant branding or asset mutation,
 * so any write automatically invalidates prior cached resolved-brand entries.
 * Cache entries expire after the signed-URL TTL (300 s) because the URL itself
 * is no longer useful after that.
 */
export interface BrandingCacheEntry<T> {
  value: T;
  revision: string;
  expiresAt: number;
}

export abstract class BrandingCache {
  abstract getOrLoad<T>(args: {
    tenantId: string;
    revision: string;
    loader: () => Promise<T>;
  }): Promise<T>;
  abstract invalidate(args: { tenantId: string }): void;
}

const DEFAULT_TTL_MS = 300_000;

export class InMemoryBrandingCache extends BrandingCache {
  private readonly entries = new Map<string, BrandingCacheEntry<unknown>>();

  async getOrLoad<T>(args: {
    tenantId: string;
    revision: string;
    loader: () => Promise<T>;
  }): Promise<T> {
    const key = this.key(args.tenantId, args.revision);
    const now = Date.now();
    const cached = this.entries.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const value = await args.loader();
    this.entries.set(key, {
      value,
      revision: args.revision,
      expiresAt: now + DEFAULT_TTL_MS,
    });
    return value;
  }

  invalidate(args: { tenantId: string }): void {
    const prefix = `${args.tenantId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  private key(tenantId: string, revision: string): string {
    return `${tenantId}:${revision}`;
  }
}

/**
 * Computes a revision token from the tenant branding row and its linked assets.
 * Any change to updatedAt or any asset id produces a new revision, busting the
 * cache without needing to enumerate cached keys.
 */
export function computeBrandingRevision(
  tenantBranding: {
    updatedAt: Date;
    logoLightAssetId?: string | null;
    logoDarkAssetId?: string | null;
    faviconAssetId?: string | null;
  } | null,
  assets: { id: string; updatedAt: Date }[]
): string {
  const baseUpdatedAt = tenantBranding?.updatedAt?.getTime() ?? 0;
  const assetRevs = assets
    .map((asset) => `${asset.id}@${asset.updatedAt.getTime()}`)
    .sort()
    .join("|");
  const fks = [
    tenantBranding?.logoLightAssetId ?? "",
    tenantBranding?.logoDarkAssetId ?? "",
    tenantBranding?.faviconAssetId ?? "",
  ].join("-");
  return `${baseUpdatedAt}-${fks}-${assetRevs}`;
}
