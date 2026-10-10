/**
 * Prisma-backed implementations of the fiscal ports for NewSaaS.
 *
 * [[DEC-055]] Q1: the API and the worker share one implementation of the
 * timbrado range store, one read of the emitter profile and one read of the
 * signing material, and `packages/fiscal` keeps depending on neither Prisma nor
 * `@newsaas/database`. The package ships the factories and their client shapes —
 * no Prisma client, no driver, no NestJS module. The composition root that owns
 * the client is the application.
 */

export { createTimbradoRangeStore } from "./timbrado-range.store.js";
export type {
  TimbradoRangePrismaClient,
  TimbradoRangePrismaDelegate,
} from "./timbrado-range.store.js";

export { createFiscalProfileReader } from "./emitter-profile.read.js";
export type {
  FiscalEmitterActivityRow,
  FiscalEmitterProfileRow,
  FiscalEstablishmentRow,
  FiscalProfileReadClient,
} from "./emitter-profile.read.js";

export { createFiscalCredentialReader } from "./fiscal-credential.reader.js";
export type {
  FiscalCredentialReadClient,
  FiscalCredentialReaderArgs,
  FiscalSigningMaterialReadRow,
} from "./fiscal-credential.reader.js";
