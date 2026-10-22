/**
 * The commit's business write (EPIC-19 [[IMP-003]]).
 *
 * WHAT IT IS: the `CommitWriter` the runner orchestrates over, implemented as the
 * ONE call `@newsaas/customers` exposes for creating a customer — its contacts
 * included. The import is a CALLER of the customer domain, never a second writer
 * ([[DEC-073]], [[IMP-003]]'s domain invariant): a record this creates is
 * indistinguishable from one created by `POST /customers`, because it is created
 * by the same function, with the same validation already applied, the same audit
 * action and the same transaction shape.
 *
 * WHY THE TRANSACTION IS NOT HERE. `createCustomer` opens its own transaction —
 * the customer, its contacts and their audit rows — and this writer passes it the
 * client and gets out of the way. A worker that opened its own would be a second,
 * differently-shaped atomicity guarantee for the same write, and the per-row
 * boundary [[DEC-071]] requires is exactly "one `createCustomer` call".
 *
 * WHY IT LIVES IN THIS PACKAGE AND NOT IN THE WORKER. The worker cannot import
 * `@newsaas/customers` directly (it declares no dependency on it, and adding one
 * would change a deployable's manifest for a call this package already has the
 * dependency for). So the composition — payload plus contacts plus audit appender
 * plus actor — lives here, next to the `CommitWriter` contract it implements, and
 * the worker supplies only its client, its audit appender, the tenant it read from
 * the row and the profile it resolved from the row's uploader. The package stays
 * Prisma-free: `db` is the structural handle `createCustomer` already declares.
 */

import { createCustomer } from "@newsaas/customers";
import type { CustomerAuditAppender, CustomerCreateDb } from "@newsaas/customers";
import type { CustomerRowReady } from "./commit.js";
import type { CommitWriter } from "./commit-runner.js";

export interface CustomerCommitWriterArgs {
  /** The client that opens the one transaction each row writes in. */
  readonly db: CustomerCreateDb;
  /** The audit appender that joins that transaction. */
  readonly audit: CustomerAuditAppender;
  /**
   * Resolved by the CALLER from the `import_job` row it loaded — never from a
   * request, and never from the job payload.
   */
  readonly tenantId: string;
  /** The profile behind the row's uploader: the actor every audit row attributes. */
  readonly actorUserProfileId: string;
}

/**
 * Builds the writer for one import's commit.
 *
 * It is bound to one tenant and one actor because the runner never sees either:
 * the runner decides WHICH rows to write and the persistence decides when the
 * phase ends, while the identity a record is written under belongs to the import
 * the caller loaded.
 */
export function createCustomerCommitWriter({
  db,
  audit,
  tenantId,
  actorUserProfileId,
}: CustomerCommitWriterArgs): CommitWriter {
  return {
    create: async (row: CustomerRowReady): Promise<void> => {
      await createCustomer({
        db,
        audit,
        tenantId,
        actorUserProfileId,
        input: row.input,
        // The row's own contacts: phone then e-mail, already validated by the
        // package's contact contract. They are written in the customer's
        // transaction, so a customer imported with a phone number cannot exist
        // without it.
        contacts: row.contacts,
      });
    },
  };
}
