import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StoragePort } from "./storage.port.js";

export interface S3StorageConfig {
  /** S3 bucket that holds all tenant branding assets. */
  bucket: string;
  /** Optional endpoint for S3-compatible services (MinIO, LocalStack). */
  endpoint?: string;
  /** AWS region. Defaults to us-east-1. */
  region?: string;
  /** Optional prefix added to every key; never exposed outside the driver. */
  keyPrefix?: string;
}

/**
 * S3-compatible StoragePort implementation. Credentials are resolved through
 * the AWS SDK default chain (environment, instance/profile, etc.) so secrets
 * never live in tenant settings or application records.
 */
export class S3StorageDriver implements StoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region ?? "us-east-1",
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  async put(args: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ key: string; byteSize: number }> {
    const finalKey = this.prefixedKey(args.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: finalKey,
        Body: args.body,
        ContentType: args.contentType,
        Metadata: args.metadata,
      })
    );
    return { key: args.key, byteSize: args.body.length };
  }

  async delete(args: { key: string }): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.prefixedKey(args.key),
      })
    );
  }

  async signedUrl(args: { key: string; expiresInSeconds: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.prefixedKey(args.key),
      }),
      { expiresIn: args.expiresInSeconds }
    );
  }

  async get(args: { key: string }): Promise<{ body: Buffer; contentType: string }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.prefixedKey(args.key),
      })
    );
    const chunks: Buffer[] = [];
    const stream = response.Body as import("node:stream").Readable;
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return {
      body: Buffer.concat(chunks),
      contentType: response.ContentType ?? "application/octet-stream",
    };
  }

  private prefixedKey(key: string): string {
    const prefix = this.config.keyPrefix;
    return prefix ? `${prefix}/${key}` : key;
  }
}
