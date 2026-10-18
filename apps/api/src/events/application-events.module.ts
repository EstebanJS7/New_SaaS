import { Global, Module } from "@nestjs/common";
import { createEventDispatcher, type EventDispatcher } from "@newsaas/shared";

/**
 * The in-process post-commit dispatcher, as an application provider.
 *
 * `packages/shared` ships `createEventDispatcher` and deliberately ships no Nest
 * module: it is framework-free so web, api and worker can all import it. Each
 * deployable therefore composes its own instance — which is also the only correct
 * shape, because the dispatcher is **in-process** and a reaction only observes an
 * event published in the SAME process ([[DEC-059]]).
 *
 * `@Global` because every publisher is a service in a leaf domain module
 * (Scheduling today, Fiscal's worker paths next) and threading a token through
 * four modules to reach one process-wide object would be noise. The dispatcher
 * holds no tenant state: it is a registry of handlers and a fan-out.
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
