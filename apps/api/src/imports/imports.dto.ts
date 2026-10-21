import type {
  ImportEntityValue,
  ImportJobRow,
  ImportJobStateValue,
  ImportRowOutcomeRow,
  ImportRowStatusValue,
} from "./imports.repository.js";

/**
 * The imports response contract (EPIC-19 IMP-001).
 *
 * Two properties are the DTO's whole job:
 *
 * 1. **It is an allowlist.** Every field below is named in a mapper, and those
 *    mappers are the ONLY way a row leaves this module, so a column added to the
 *    aggregate later cannot leak by appearing.
 * 2. **The storage key is NOT here, and must never be.** `import_job.storage_key`
 *    is an internal handle to a tenant's customer list sitting in object storage
 *    ([[DEC-072]]): it appears in no response, in no error message and in no audit
 *    metadata, and no browser-reachable URL is ever issued for it. The upload
 *    response is `{ importId, state }` and nothing else — the caller gets an
 *    identifier to poll, not a way into the bytes.
 *
 * Data classification (PRD §41): everything here is INTERNAL — an entity kind, a
 * state, byte and row counts, and instants. No personal data is read from the
 * file and none is stored on the aggregate, which is why a job's response can be
 * shown to any role holding `imports.read`.
 *
 * Prisma models are never returned; only the keys declared here leave the
 * process.
 */

/**
 * The preview trigger's response: the identifier and the state it was accepted
 * INTO.
 *
 * Deliberately two fields, like the upload's. `state` is `PREVIEWING` because that
 * is the phase the import has been queued for ([[DEC-072]]: always asynchronous),
 * not a claim that the row already reads that way — the worker's claim is what
 * performs the transition, so the caller polls and sees the truth.
 */
export interface ImportPreviewAcceptedResponse {
  readonly importId: string;
  readonly state: "PREVIEWING";
}

/**
 * The upload response: an identifier and the state to poll.
 *
 * Deliberately two fields. The import is asynchronous by decision ([[DEC-072]]),
 * so the honest answer to an upload is "accepted, here is what to watch", not a
 * summary the request cannot have yet.
 */
export interface ImportUploadResponse {
  readonly importId: string;
  readonly state: ImportJobStateValue;
}

/**
 * One import job with its counters.
 *
 * `createdCount + failedCount` is the number of data rows the preview saw, and
 * `suspectedDuplicateCount` is a subset of `createdCount` rather than a third
 * bucket ([[DEC-071]]: the record is created and the suspicion is reported).
 *
 * `artefactExpiresAt` and `artefactDeletedAt` are exposed because the surface
 * has to be able to say when the uploaded file stops existing — which is the
 * whole point of the TTL — without ever being able to reach it.
 */
export interface ImportJobResponse {
  readonly id: string;
  readonly entity: ImportEntityValue;
  readonly state: ImportJobStateValue;
  readonly contentType: string;
  readonly byteSize: number;
  readonly createdCount: number;
  readonly failedCount: number;
  readonly suspectedDuplicateCount: number;
  readonly previewedAt: string | null;
  readonly committedAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
  readonly artefactExpiresAt: string;
  readonly artefactDeletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One row's verdict, as the result summary will report it ([[DEC-071]]).
 *
 * THIS PROJECTION IS THE NO-PERSONAL-DATA PROMISE IN TYPE FORM. There is no name,
 * no phone, no e-mail, no document number, no species, no birth date, and no id of
 * the customer or patient the row produced: the record the import created already
 * holds those, and a second copy here would be personal data in a table with no
 * retention story. `message` names the condition — "document number already
 * exists" — and never the value.
 *
 * IMP-001 ships the type and the mapper, not a route: [[IMP-003]]/[[IMP-004]]
 * serve the summary. It exists here because the redaction rule is a property of
 * the aggregate, and a property first asserted when its endpoint appears is a
 * property nobody checked.
 */
export interface ImportRowOutcomeResponse {
  readonly importId: string;
  readonly rowNumber: number;
  readonly status: ImportRowStatusValue;
  readonly reasonCode: string | null;
  readonly message: string | null;
  readonly suspectedDuplicate: boolean;
}

/** The upload response mapper: two fields, and the identifier is the job's own. */
export function toImportUploadResponse(row: ImportJobRow): ImportUploadResponse {
  return { importId: row.id, state: row.state };
}

/**
 * The preview trigger's mapper: the id and the phase it was accepted into.
 *
 * `PREVIEWING` is a literal rather than a read of the row, on purpose: the row is
 * still `UPLOADED` at this instant, and returning it would tell the caller the
 * preview is not coming. The transition is the worker's (see the service).
 */
export function toImportPreviewAcceptedResponse(importId: string): ImportPreviewAcceptedResponse {
  return { importId, state: "PREVIEWING" };
}

/**
 * The job mapper. `storageKey`, `tenantId` and `createdByMembershipId` are
 * deliberately absent: the first must never leave the server, and the other two
 * are server-owned authority the caller already proves by asking.
 */
export function toImportJobResponse(row: ImportJobRow): ImportJobResponse {
  return {
    id: row.id,
    entity: row.entity,
    state: row.state,
    contentType: row.contentType,
    byteSize: row.byteSize,
    createdCount: row.createdCount,
    failedCount: row.failedCount,
    suspectedDuplicateCount: row.suspectedDuplicateCount,
    previewedAt: toIsoOrNull(row.previewedAt),
    committedAt: toIsoOrNull(row.committedAt),
    failedAt: toIsoOrNull(row.failedAt),
    failureReason: row.failureReason,
    artefactExpiresAt: row.artefactExpiresAt.toISOString(),
    artefactDeletedAt: toIsoOrNull(row.artefactDeletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The row-outcome mapper: a verdict, a reason and a flag — nothing else. */
export function toImportRowOutcomeResponse(row: ImportRowOutcomeRow): ImportRowOutcomeResponse {
  return {
    importId: row.importId,
    rowNumber: row.rowNumber,
    status: row.status,
    reasonCode: row.reasonCode,
    message: row.message,
    suspectedDuplicate: row.suspectedDuplicate,
  };
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
