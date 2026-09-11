/**
 * Object-storage port. Only opaque keys cross this boundary; bucket names,
 * paths, and provider credentials stay inside the driver implementation.
 *
 * The port is intentionally narrow: put, delete, and signed-url generation.
 * Listing or public reads are intentionally absent — asset URLs are always
 * short-lived signed URLs generated server-side.
 */
export interface StoragePort {
  /**
   * Persists bytes under an opaque key. The key is caller-supplied so the
   * branding layer can keep its own opaque-key factory; the driver must treat
   * it as an opaque identifier, not a filesystem path.
   */
  put(args: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; byteSize: number }>;

  /** Removes the bytes referenced by an opaque key. Idempotent. */
  delete(args: { key: string }): Promise<void>;

  /**
   * Creates a short-lived signed URL for the object. Throws if the key does
   * not exist or has been retired.
   *
   * This URL is for API-to-storage communication only; it must never be
   * returned to clients. Client-facing delivery goes through the application
   * proxy/signer so bucket names, object keys, and provider paths stay hidden.
   */
  signedUrl(args: { key: string; expiresInSeconds: number }): Promise<string>;

  /**
   * Retrieves the bytes and content type for an opaque key. Used by the
   * application asset proxy to stream content to clients without exposing the
   * underlying storage provider or key.
   */
  get(args: { key: string }): Promise<{ body: Buffer; contentType: string }>;
}
