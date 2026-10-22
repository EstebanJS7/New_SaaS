/**
 * The patient commit's business write (EPIC-19 [[IMP-004]]).
 *
 * WHAT IT IS: the commit writer the runner orchestrates over, implemented as the ONE
 * call `@newsaas/patients` exposes for creating a patient — its primary guardian and
 * both audit rows included. The import is a CALLER of the veterinary domain, never a
 * second writer: a patient this creates is indistinguishable from one created by
 * `POST /patients`, because it is created by the same function, from the same
 * validated payload, with the same audit actions and the same transaction shape.
 *
 * WHY THE TRANSACTION IS NOT HERE. `createPatient` opens its own transaction — the
 * patient, its primary guardian link and both audit rows — and this writer passes it
 * the client and gets out of the way. A worker that opened its own would be a second,
 * differently-shaped atomicity guarantee for the same three writes.
 *
 * THE DEFERRED TRIGGER IS SATISFIED THE SAME WAY A MANUAL ENTRY SATISFIES IT.
 * `patient_exactly_one_primary_guardian` is `DEFERRABLE INITIALLY DEFERRED`, checked
 * at COMMIT: the patient row is inserted, the guardian link is inserted inside the
 * same transaction, and the transaction commits with exactly one active primary
 * guardian. A committed patient therefore always has an owner, and a row whose
 * guardian cannot be linked rolls the whole thing back — [[DEC-070]]'s "nothing is
 * half-created".
 *
 * WHY IT LIVES IN THIS PACKAGE AND NOT IN THE WORKER: the worker declares no
 * dependency on `@newsaas/patients` (it would change a deployable's manifest for a
 * call this package already has the dependency for), so the composition — payload
 * plus tenant plus actor plus the catalog and the audit appender — lives here, next to
 * the `CommitWriter` contract it implements. The worker supplies only its client, its
 * audit appender, the tenant it read from the row, the profile it resolved from the
 * row's uploader, and the taxonomy it prefetched.
 */

import { createPatient } from "@newsaas/patients";
import type { PatientAuditAppender, PatientCatalog, PatientCreateDb } from "@newsaas/patients";
import type { CommitWriter } from "./commit-runner.js";
import type { PatientRowReady } from "./patient-commit.js";

export interface PatientCommitWriterArgs {
  /** The client that opens the one transaction each row writes in. */
  readonly db: PatientCreateDb;
  /** The audit appender that joins that transaction. */
  readonly audit: PatientAuditAppender;
  /**
   * The taxonomy `createPatient` validates the payload's ids against. The worker
   * builds it from the SAME prefetched snapshot the row was resolved from, so the
   * global catalog is read once per job rather than once per row.
   */
  readonly catalog: PatientCatalog;
  /**
   * Resolved by the CALLER from the `import_job` row it loaded — never from a
   * request, and never from the job payload.
   */
  readonly tenantId: string;
  /** The profile behind the row's uploader: the actor both audit rows attribute. */
  readonly actorUserProfileId: string;
}

/**
 * Builds the writer for one patient import's commit.
 *
 * It is bound to one tenant, one actor and one catalog snapshot because the runner
 * never sees any of them: the runner decides WHICH rows to write and the persistence
 * decides when the phase ends, while the identity a record is written under belongs
 * to the import the caller loaded.
 */
export function createPatientCommitWriter({
  db,
  audit,
  catalog,
  tenantId,
  actorUserProfileId,
}: PatientCommitWriterArgs): CommitWriter<PatientRowReady> {
  return {
    create: async (row: PatientRowReady): Promise<void> => {
      await createPatient({
        db,
        audit,
        catalog,
        tenantId,
        actorUserProfileId,
        // The row's own payload, guardian included: `createPatient` links it as the
        // ACTIVE PRIMARY guardian inside the same transaction, so a committed patient
        // never exists without one ([[DEC-070]]).
        input: row.input,
      });
    },
  };
}
