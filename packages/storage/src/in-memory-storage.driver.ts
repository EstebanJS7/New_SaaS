import type { StoragePort } from "./storage.port.js";

interface StoredObject {
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

/**
 * In-memory StoragePort implementation for tests and local development.
 *
 * Signed URLs are synthetic (`memory://{key}?expires=...`) and are not served
 * by an HTTP endpoint; tests assert on key retirement and URL replacement,
 * not on byte retrieval through the URL.
 */
export class InMemoryStorageDriver implements StoragePort {
  private readonly objects = new Map<string, StoredObject>();

  put(args: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; byteSize: number }> {
    this.objects.set(args.key, {
      body: Buffer.from(args.body),
      contentType: args.contentType,
      metadata: args.metadata,
    });
    return Promise.resolve({ key: args.key, byteSize: args.body.length });
  }

  delete(args: { key: string }): Promise<void> {
    this.objects.delete(args.key);
    return Promise.resolve();
  }

  signedUrl(args: { key: string; expiresInSeconds: number }): Promise<string> {
    const stored = this.objects.get(args.key);
    if (!stored) {
      return Promise.reject(new Error(`Storage key not found: ${args.key}`));
    }
    const expiresAt = Date.now() + args.expiresInSeconds * 1000;
    return Promise.resolve(`memory://${args.key}?expires=${expiresAt}&sig=memory`);
  }

  get(args: { key: string }): Promise<{ body: Buffer; contentType: string }> {
    const stored = this.objects.get(args.key);
    if (!stored) {
      return Promise.reject(new Error(`Storage key not found: ${args.key}`));
    }
    return Promise.resolve({
      body: Buffer.from(stored.body),
      contentType: stored.contentType,
    });
  }

  /** Test seam: returns true if the key is still stored. */
  hasKey(key: string): boolean {
    return this.objects.has(key);
  }

  /** Test seam: returns the stored bytes for a key. */
  getBytes(key: string): Buffer | undefined {
    return this.objects.get(key)?.body;
  }

  /** Test seam: returns the number of stored objects. */
  size(): number {
    return this.objects.size;
  }

  /** Test seam: clears all stored objects. */
  clear(): void {
    this.objects.clear();
  }
}
