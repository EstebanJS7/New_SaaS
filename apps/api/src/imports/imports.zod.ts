import { z } from "zod";
import { IMPORT_ENTITY_VALUES } from "./imports.repository.js";

/**
 * Request contract for the imports surface (EPIC-19 IMP-001).
 *
 * Two shapes only, because the surface has two inputs: the `entity` field of the
 * multipart upload and the bounded page of the list read. The uploaded FILE is
 * not validated here — it is a byte stream, and it is validated by
 * `ImportArtefactPipe` against the size cap and the CSV allowlist before a
 * single byte reaches storage. Keeping the two apart is what lets the file's
 * refusals have their own stable messages instead of a parser's paraphrase.
 *
 * There is no `.strict()` body schema for the upload itself: multipart bodies
 * are not JSON, so unknown FIELDS are simply ignored (the only fields read are
 * `entity` and the file) rather than silently re-scoped. `tenantId` is never an
 * input anywhere on this surface — it comes from the request context.
 */

/**
 * Current contract version of the imports DTO, carried in every import audit
 * row's metadata. Bumped when the accepted key set or value formats change (the
 * cash/catalog convention).
 */
export const IMPORTS_DTO_SCHEMA_VERSION = 1;

/**
 * The `entity` multipart field. The enum IS the validation, and it is spelled
 * from the persistence vocabulary ({@link IMPORT_ENTITY_VALUES}) rather than
 * re-typed here, so a value the database cannot store cannot be accepted.
 */
export const importEntityField = z.enum(IMPORT_ENTITY_VALUES);

/**
 * The list read's default page size, and its ceiling.
 *
 * Every import keeps its per-row outcome forever ([[DEC-071]] made the outcome
 * the durable artefact), so the list can only grow. [[TD-026]] records unbounded
 * list endpoints as open debt and a new surface must not worsen it: the page is
 * BOUNDED at the contract, and an oversized `limit` is REFUSED rather than
 * clamped — a caller that asked for 1000 must learn that it did not get 1000,
 * because a silently truncated page is a page that lies about what exists.
 */
export const IMPORT_LIST_LIMIT_DEFAULT = 50;
export const IMPORT_LIST_LIMIT_MAX = 100;

/** Stable `400` for an unreadable import id in the path. */
export const IMPORT_ID_INVALID_MESSAGE = "The import id must be a UUID.";

/** Stable `400` for an unreadable list query. */
export const IMPORT_LIST_QUERY_INVALID_MESSAGE = "Invalid import list filters.";

/**
 * The summary page's default size, and its ceiling ([[DEC-071]], [[IMP-003]]).
 *
 * A summary is the artefact an operator keeps, and its row list can be as long as
 * the file was — so it is served as a BOUNDED page, and an oversized `limit` is
 * REFUSED rather than clamped for the same reason the list read refuses one: a
 * silently shortened page is a page that lies about what exists ([[TD-026]]). The
 * TOTALS are always the whole import; only the ROWS are paged.
 *
 * 100 rows is a page an operator can read on one screen and a failure list an
 * operator can scan; 500 is the most one response may carry.
 */
export const IMPORT_SUMMARY_LIMIT_DEFAULT = 100;
export const IMPORT_SUMMARY_LIMIT_MAX = 500;

/** Stable `400` for an unreadable summary query. */
export const IMPORT_SUMMARY_QUERY_INVALID_MESSAGE = "Invalid import summary filters.";

/**
 * The list query, as a CLOSED schema: an unknown key is refused rather than
 * ignored, and `limit` above {@link IMPORT_LIST_LIMIT_MAX} is refused rather
 * than truncated.
 */
export const importListQuery = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(IMPORT_LIST_LIMIT_MAX, `The limit must be at most ${IMPORT_LIST_LIMIT_MAX}.`)
      .optional(),
    /**
     * Narrows the history to one entity ([[IMP-004]]). Optional and CLOSED: an
     * unknown value is refused rather than ignored, like every other key here, so
     * a typo cannot silently return the whole list under a filter the caller
     * believes it applied.
     */
    entity: z.enum(["CUSTOMER", "PATIENT"]).optional(),
  })
  .strict();

export type ImportListQuery = z.infer<typeof importListQuery>;

/** The `GET /imports/:id` path parameter. */
export const importIdParam = z.object({ id: z.string().uuid() }).strict();

/**
 * The summary query: a CLOSED schema like the list's, with the same rule at the
 * ceiling — an unknown key, a non-integer or an oversized page is refused rather
 * than ignored or truncated.
 *
 * `offset` is bounded below at zero and unbounded above on purpose: an offset past
 * the last row is a legitimate request that answers an empty page, and inventing a
 * ceiling for it would refuse a request the caller can answer nothing about. The
 * page SIZE is what protects the response, which is what a ceiling is for.
 */
export const importSummaryQuery = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(IMPORT_SUMMARY_LIMIT_MAX, `The limit must be at most ${IMPORT_SUMMARY_LIMIT_MAX}.`)
      .optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type ImportSummaryQuery = z.infer<typeof importSummaryQuery>;
