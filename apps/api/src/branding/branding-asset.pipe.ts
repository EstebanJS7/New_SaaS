import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyRequest } from "fastify";
import { DomainError } from "@newsaas/shared";
import { BRANDING_ASSET_LIMITS } from "./branding-asset-limits.js";

export type BrandingAssetKind = "logoLight" | "logoDark" | "favicon";

export interface ParsedBrandingAssetFile {
  buffer: Buffer;
  contentType: string;
  byteSize: number;
  sha256: string;
}

const BRANDING_ASSET_KINDS: readonly BrandingAssetKind[] = ["logoLight", "logoDark", "favicon"];

const LOGO_KINDS: readonly BrandingAssetKind[] = ["logoLight", "logoDark"];

const ALLOWED_CONTENT_TYPES: readonly string[] = [
  "image/png",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

/**
 * Parses and validates a Fastify multipart upload for a branding asset.
 *
 * - Rejects unknown/missing kinds.
 * - Reads the file stream into memory.
 * - Caps size per kind.
 * - Sniffs magic bytes and rejects mismatched/unknown/disallowed MIME types.
 * - Computes SHA-256 for integrity and idempotency.
 */
export class BrandingAssetPipe {
  assertKind(value: string): BrandingAssetKind {
    if (!BRANDING_ASSET_KINDS.includes(value as BrandingAssetKind)) {
      throw new DomainError("VALIDATION_FAILED", `Invalid branding asset kind: ${value}.`);
    }
    return value as BrandingAssetKind;
  }

  async parse(request: FastifyRequest, kind: BrandingAssetKind): Promise<ParsedBrandingAssetFile> {
    let file;
    try {
      file = await request.file();
    } catch (error) {
      // @fastify/multipart rejects oversized parts with a FastifyError whose
      // code starts with FST_PART; map it to the public 413 envelope.
      if (this.isMultipartSizeError(error)) {
        throw new DomainError(
          "PAYLOAD_TOO_LARGE",
          `${kind} exceeds the maximum allowed upload size.`
        );
      }
      throw error;
    }

    if (!file) {
      throw new DomainError("VALIDATION_FAILED", "No file uploaded.");
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (error) {
      if (this.isMultipartSizeError(error)) {
        throw new DomainError(
          "PAYLOAD_TOO_LARGE",
          `${kind} exceeds the maximum allowed upload size.`
        );
      }
      throw error;
    }

    const byteSize = buffer.length;
    const limit = LOGO_KINDS.includes(kind)
      ? BRANDING_ASSET_LIMITS.logo
      : BRANDING_ASSET_LIMITS.favicon;

    if (byteSize > limit) {
      throw new DomainError("PAYLOAD_TOO_LARGE", `${kind} exceeds the ${limit} byte limit.`);
    }

    const sniffed = await fileTypeFromBuffer(buffer);
    const declaredType = file.mimetype;

    if (!sniffed) {
      throw new DomainError("VALIDATION_FAILED", `Could not determine the file type for ${kind}.`);
    }

    const resolvedType = sniffed.mime;

    if (!ALLOWED_CONTENT_TYPES.includes(resolvedType)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `File type ${resolvedType} is not allowed for ${kind}.`
      );
    }

    if (resolvedType !== declaredType) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `Declared MIME type ${declaredType} does not match file content ${resolvedType}.`
      );
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");

    return {
      buffer,
      contentType: resolvedType,
      byteSize,
      sha256,
    };
  }

  private isMultipartSizeError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      (error as { code: string }).code.startsWith("FST_PART")
    );
  }
}
