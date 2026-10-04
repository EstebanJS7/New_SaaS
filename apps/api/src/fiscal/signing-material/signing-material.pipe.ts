import { DomainError } from "@newsaas/shared";
import type { FastifyRequest } from "fastify";
import {
  SIGNING_MATERIAL_MAX_CONTAINER_BYTES,
  signingMaterialEnvironmentSchema,
} from "./signing-material.zod.js";
import type { FiscalSigningEnvironment } from "./signing-material.service.js";

export interface ParsedSigningMaterialUpload {
  container: Buffer;
  password: string;
  environment: FiscalSigningEnvironment;
}

/** Parses one PKCS#12 file and its companion fields without depending on part order. */
export class SigningMaterialPipe {
  async parse(request: FastifyRequest): Promise<ParsedSigningMaterialUpload> {
    let container: Buffer | undefined;
    let password: string | undefined;
    let environment: FiscalSigningEnvironment | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file" || container !== undefined) {
            await part.toBuffer();
            throw new DomainError("VALIDATION_FAILED", "Expected a single file part named file.");
          }
          try {
            container = await part.toBuffer();
          } catch (error) {
            if (this.isMultipartSizeError(error)) {
              throw new DomainError(
                "PAYLOAD_TOO_LARGE",
                "Signing container exceeds the maximum allowed upload size."
              );
            }
            throw error;
          }
          if (container.length > SIGNING_MATERIAL_MAX_CONTAINER_BYTES) {
            throw new DomainError(
              "PAYLOAD_TOO_LARGE",
              "Signing container exceeds the maximum allowed upload size."
            );
          }
        } else if (part.fieldname === "password") {
          if (password !== undefined)
            throw new DomainError("VALIDATION_FAILED", "Invalid signing material upload parts.");
          if (typeof part.value !== "string")
            throw new DomainError("VALIDATION_FAILED", "Invalid password part.");
          password = part.value;
        } else if (part.fieldname === "environment") {
          if (environment !== undefined)
            throw new DomainError("VALIDATION_FAILED", "Invalid signing material upload parts.");
          if (typeof part.value !== "string")
            throw new DomainError("VALIDATION_FAILED", "Invalid signing material environment.");
          const parsed = signingMaterialEnvironmentSchema.safeParse(part.value);
          if (!parsed.success)
            throw new DomainError("VALIDATION_FAILED", "Invalid signing material environment.");
          environment = parsed.data;
        } else {
          throw new DomainError("VALIDATION_FAILED", "Invalid signing material upload part.");
        }
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (this.isMultipartSizeError(error)) {
        throw new DomainError(
          "PAYLOAD_TOO_LARGE",
          "Signing container exceeds the maximum allowed upload size."
        );
      }
      throw error;
    }
    if (
      !container ||
      password === undefined ||
      password.length < 1 ||
      password.length > 1024 ||
      !environment
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Signing material upload requires file, password and environment parts."
      );
    }
    return { container, password, environment };
  }

  private isMultipartSizeError(error: unknown): boolean {
    // Detect by status, not by a code prefix. `@fastify/error` sets
    // `statusCode` alongside `code`, and `@fastify/multipart` raises four
    // different 413s: `FST_REQ_FILE_TOO_LARGE` (the file exceeds the global
    // ceiling), `FST_FILES_LIMIT`, `FST_FIELDS_LIMIT` and `FST_PARTS_LIMIT`.
    // Matching an `FST_PART` prefix caught only the last one, so an oversized
    // file surfaced as a 500 instead of a 413; the status is the signal that
    // survives a code rename.
    return (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      (error as { statusCode?: unknown }).statusCode === 413
    );
  }
}
