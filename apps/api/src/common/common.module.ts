import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { GlobalExceptionFilter } from "./filters/global-exception.filter.js";

/**
 * Cross-cutting API concerns.
 *
 * The global exception filter is registered through APP_FILTER (not
 * `useGlobalFilters`) so it participates in DI and is active for every
 * module that composes this one — including the production AppModule and
 * contract-test harnesses, which is what makes the envelope wiring provable
 * at HTTP level in tests.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class CommonModule {}
