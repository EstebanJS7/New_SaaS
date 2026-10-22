import type { FastifyRequest } from "fastify";
import { DomainError } from "@newsaas/shared";
import type { ImportEntityValue } from "./imports.repository.js";
import { importEntityField } from "./imports.zod.js";

/**
 * Multipart parsing and validation for an import upload (EPIC-19 IMP-001).
 *
 * The `BrandingAssetPipe` precedent, with one deliberate difference: this pipe
 * walks `request.parts()` instead of `request.file()` because the two fields of
 * this upload — `entity` and the file — have NO required order. `request.file()`
 * resolves on the first file part and hands back the fields it has parsed by
 * then, so a client that sends the file before the entity field would be read as
 * an upload with no entity. Walking the parts is the contract the client
 * actually has.
 *
 * What it enforces, each with its OWN stable message so the caller can tell the
 * failures apart:
 *
 * 1. the request is multipart at all;
 * 2. the file's extension is not a spreadsheet — an `.xlsx`/`.xls` upload is
 *    refused BY NAME with a message that says CSV is the accepted format, rather
 *    than surfacing as a generic parse failure later ([[DEC-068]]);
 * 3. the declared content type is one of the two CSV types;
 * 4. the byte size is within {@link IMPORT_ARTEFACT_MAX_BYTES}.
 *
 * The size cap is enforced twice on purpose: the multipart transport limit is
 * raised for THIS request to the import cap (the plugin's global 2 MiB ceiling
 * belongs to branding, and a CSV of a customer list is legitimately larger), and
 * the buffered byte count is checked again here, so the cap holds even if a
 * future adapter raises the transport ceiling.
 *
 * Nothing here parses CSV content: [[IMP-002]] owns the preview and the row
 * rules. This pipe only decides whether the bytes are an acceptable artefact.
 */

/**
 * The upload size cap for an import artefact: 5 MiB.
 *
 * A CSV of a tenant's customers and patients is text, and "hundreds of rows" —
 * the size the epic is designed for — is tens of kilobytes. 5 MiB is roughly two
 * orders of magnitude of headroom over that, which is enough to accept a real
 * export without accepting a file whose processing would tie up a worker for
 * minutes.
 */
export const IMPORT_ARTEFACT_MAX_BYTES = 5_242_880;

/**
 * The accepted content types. Exactly two spellings of CSV, because vendors
 * disagree about which one a `.csv` file is and both are unambiguously CSV.
 * Everything else — including every spreadsheet type — is refused.
 */
export const IMPORT_ARTEFACT_ALLOWED_CONTENT_TYPES = Object.freeze([
  "text/csv",
  "application/csv",
] as const);

/** Extensions refused by NAME ([[DEC-068]]: XLSX is out of scope, [[TD-057]]). */
const REJECTED_SPREADSHEET_EXTENSIONS = Object.freeze([".xlsx", ".xls"]);

/**
 * Stable refusal messages. One per condition, so "too big", "wrong format" and
 * "spreadsheet" are separable by a caller and by an operator reading the surface.
 */
export const IMPORT_ARTEFACT_MULTIPART_MESSAGE =
  "An import must be uploaded as a multipart/form-data request.";
export const IMPORT_ARTEFACT_MISSING_FILE_MESSAGE = "An import requires one uploaded file.";
export const IMPORT_ARTEFACT_MULTIPLE_FILES_MESSAGE =
  "An import accepts exactly one uploaded file.";
export const IMPORT_ARTEFACT_SPREADSHEET_MESSAGE =
  "Spreadsheet uploads are not supported: export the data as CSV. The accepted format is CSV (text/csv).";
export const IMPORT_ARTEFACT_CONTENT_TYPE_MESSAGE =
  "The import file must be CSV. The accepted content types are text/csv and application/csv.";
export const IMPORT_ARTEFACT_ENTITY_MESSAGE =
  "The entity field is required and must be CUSTOMER or PATIENT.";
export const IMPORT_ARTEFACT_SIZE_MESSAGE = `The import file exceeds the ${IMPORT_ARTEFACT_MAX_BYTES} byte limit.`;

/** The validated artefact, buffered and ready to be written to storage. */
export interface ParsedImportArtefact {
  readonly buffer: Buffer;
  readonly filename: string;
  /** The DECLARED content type, normalized and lower-cased (one of the allowlist). */
  readonly contentType: string;
  readonly byteSize: number;
  readonly entity: ImportEntityValue;
}

interface BufferedFilePart {
  readonly filename: string;
  readonly declaredContentType: string;
  readonly buffer: Buffer;
}

/** Fastify/@fastify-multipart error codes this pipe translates. */
const MULTIPART_SIZE_ERROR_CODES = new Set([
  // The transport file-size ceiling was reached (busboy `fileSize`).
  "FST_REQ_FILE_TOO_LARGE",
]);

export class ImportArtefactPipe {
  /**
   * Parses one import upload. Returns the buffered bytes plus the entity the
   * operator declared; throws a `DomainError` with a stable message for every
   * refusal, BEFORE the caller touches storage.
   */
  async parse(request: FastifyRequest): Promise<ParsedImportArtefact> {
    if (!request.isMultipart()) {
      throw new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_MULTIPART_MESSAGE);
    }

    let rawEntity: unknown;
    let filePart: BufferedFilePart | null = null;

    try {
      const parts = request.parts({
        // Per-request transport ceilings: the import cap replaces the plugin's
        // global (branding-sized) one. `files: 1` makes a second file a
        // transport-level refusal instead of a half-consumed stream.
        limits: { fileSize: IMPORT_ARTEFACT_MAX_BYTES, files: 1, fields: 4 },
      });

      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "entity") {
            rawEntity = part.value;
          }
          continue;
        }

        // Refuse a spreadsheet by NAME before buffering it: the message is about
        // the format the operator chose, which the content type alone cannot say
        // (an `.xlsx` is also simply "not in the allowlist").
        this.assertNotSpreadsheet(part.filename);

        if (filePart !== null) {
          throw new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_MULTIPLE_FILES_MESSAGE);
        }

        filePart = {
          filename: part.filename,
          declaredContentType: part.mimetype,
          buffer: await part.toBuffer(),
        };
      }
    } catch (error) {
      throw this.mapMultipartFailure(error);
    }

    if (filePart === null) {
      throw new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_MISSING_FILE_MESSAGE);
    }

    const entity = importEntityField.safeParse(rawEntity);
    if (!entity.success) {
      throw new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_ENTITY_MESSAGE);
    }

    const contentType = this.normalizeContentType(filePart.declaredContentType);
    if (!(IMPORT_ARTEFACT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_CONTENT_TYPE_MESSAGE);
    }

    const byteSize = filePart.buffer.length;
    if (byteSize > IMPORT_ARTEFACT_MAX_BYTES) {
      throw new DomainError("PAYLOAD_TOO_LARGE", IMPORT_ARTEFACT_SIZE_MESSAGE);
    }

    return {
      buffer: filePart.buffer,
      filename: filePart.filename,
      contentType,
      byteSize,
      entity: entity.data,
    };
  }

  /** `.xlsx`/`.xls` are refused by name, with CSV named as the accepted format. */
  private assertNotSpreadsheet(filename: string): void {
    const dot = filename.lastIndexOf(".");
    const extension = dot === -1 ? "" : filename.slice(dot).toLowerCase();
    if (REJECTED_SPREADSHEET_EXTENSIONS.includes(extension)) {
      throw new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_SPREADSHEET_MESSAGE);
    }
  }

  /** `text/csv; charset=utf-8` is still `text/csv`; case is not meaningful. */
  private normalizeContentType(declared: string): string {
    return (declared.split(";")[0] ?? "").trim().toLowerCase();
  }

  /**
   * Translates the transport's own refusals into this surface's messages and
   * leaves every other error to propagate. A `DomainError` thrown above (a
   * spreadsheet, a second file) is already the right refusal and passes through
   * untouched.
   */
  private mapMultipartFailure(error: unknown): unknown {
    if (error instanceof DomainError) {
      return error;
    }
    const code = this.errorCodeOf(error);
    if (code !== undefined && MULTIPART_SIZE_ERROR_CODES.has(code)) {
      return new DomainError("PAYLOAD_TOO_LARGE", IMPORT_ARTEFACT_SIZE_MESSAGE);
    }
    if (code === "FST_FILES_LIMIT") {
      return new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_MULTIPLE_FILES_MESSAGE);
    }
    if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
      return new DomainError("VALIDATION_FAILED", IMPORT_ARTEFACT_MULTIPART_MESSAGE);
    }
    return error;
  }

  private errorCodeOf(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
}
