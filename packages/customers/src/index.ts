/**
 * The NewSaaS customer boundary ([[DEC-073]], EPIC-19).
 *
 * It owns what a Customer IS when one is created: the discriminated create
 * schema and its rules, the allowlisted response shape and its mapper, and one
 * `createCustomer` function that writes the row and its `customer.created` audit
 * row in a single transaction.
 *
 * It exists because [[DEC-072]] put the import pipeline in the worker,
 * [[IMP-002]] forbids a second copy of any validation rule, and the worker
 * cannot import from `apps/api`. The three requirements only hold at once if the
 * rules live somewhere both deployables can reach — so they live here, and
 * `apps/api`'s `CustomersService.create` delegates to the same function the
 * worker will call.
 *
 * Framework-free by construction: no Nest decorator, no request object, no
 * ambient tenant. Everything the call needs — the client, the audit appender,
 * the tenant and the actor — is a parameter.
 */
export {
  CUSTOMER_DTO_SCHEMA_VERSION,
  createCustomerBody,
  customerIdParam,
  customerKind,
  updateCustomerBody,
  validateUpdateForKind,
} from "./customer.zod.js";
export type { CreateCustomerInput, CustomerKind, UpdateCustomerInput } from "./customer.zod.js";
export type { CustomerResponse } from "./customer.dto.js";
export { createCustomer, toCustomerResponse } from "./customer.create.js";
export type {
  CreateCustomerArgs,
  CustomerAuditAppender,
  CustomerCreateData,
  CustomerCreateDb,
  CustomerCreateDelegate,
  CustomerCreateTransaction,
  CustomerRow,
} from "./customer.create.js";
