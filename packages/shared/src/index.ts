export type {
  ApplicationEvent,
  ApplicationEventType,
  ApplicationEventHandler,
} from "./events/envelope.js";
export { createEventDispatcher } from "./events/dispatcher.js";
export { DomainError } from "./errors/domain-error.js";
export type { DomainErrorOptions } from "./errors/domain-error.js";
export { ERROR_CODES, getStatusForCode } from "./errors/registry.js";
export type { ErrorCode, ErrorCodeEntry, ErrorRegistry } from "./errors/registry.js";
