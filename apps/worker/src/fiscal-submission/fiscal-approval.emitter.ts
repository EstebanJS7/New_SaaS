import { Inject, Injectable } from "@nestjs/common";
import type { EventDispatcher } from "@newsaas/shared";
import { APPLICATION_EVENT_DISPATCHER } from "../events/application-events.module.js";

/**
 * Publishes `FiscalApproved`, and it exists so the TWO paths that enter `APPROVED`
 * cannot drift.
 *
 * A fiscal document is approved in two places — the submission handler's
 * `persistResult` and the recovery service's conditional update — and [[DEC-059]]
 * recorded the consequence of getting that wrong: *"A single publisher at one site
 * would silently lose every approval resolved by the reconciliation sweep."* One
 * helper both call is the shape that decision named.
 *
 * It publishes AFTER the caller's transaction commits, carries ids only, and its
 * failure is its own: a subscriber that throws must never roll back an approval
 * that is already committed.
 */
export const FISCAL_APPROVED = "FiscalApproved";

/** Injection token for the emitter, so a suite can substitute a recorder. */
export const FISCAL_APPROVAL_EMITTER = Symbol("FISCAL_APPROVAL_EMITTER");

export interface FiscalApprovalEmitterPort {
  emit(args: { readonly tenantId: string; readonly fiscalDocumentId: string }): void;
}

@Injectable()
export class FiscalApprovalEmitter implements FiscalApprovalEmitterPort {
  constructor(@Inject(APPLICATION_EVENT_DISPATCHER) private readonly events: EventDispatcher) {}

  emit(args: { readonly tenantId: string; readonly fiscalDocumentId: string }): void {
    this.events.publish(FISCAL_APPROVED, {
      tenantId: args.tenantId,
      aggregateId: args.fiscalDocumentId,
      // Ids only, and the subscriber re-reads the document and its invoice: a
      // payload built here could carry a value the document no longer has.
      payload: {},
    });
  }
}
