import { Global, Module } from "@nestjs/common";
import { createEventDispatcher, type EventDispatcher } from "@newsaas/shared";

/**
 * The worker's in-process post-commit dispatcher.
 *
 * The API has its own, and two instances are correct rather than duplicated: the
 * dispatcher is **in-process**, so a reaction only observes an event published by
 * its OWN deployable ([[DEC-059]]). Fiscal documents are approved in the worker,
 * so the worker is where `FiscalApproved` is published and where the reaction that
 * creates the notification intent must live. Wiring the API's instance here would
 * publish into a process that has no subscriber for it.
 */
export const APPLICATION_EVENT_DISPATCHER = Symbol("APPLICATION_EVENT_DISPATCHER");

@Global()
@Module({
  providers: [
    {
      provide: APPLICATION_EVENT_DISPATCHER,
      useFactory: (): EventDispatcher => createEventDispatcher(),
    },
  ],
  exports: [APPLICATION_EVENT_DISPATCHER],
})
export class ApplicationEventsModule {}
