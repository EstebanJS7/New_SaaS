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

// FISC-015 WU-C: the tenant's fiscal identity, read through the same shape — a
// structural client, the tenant in the `where`, no ambient context and no Prisma
// type crossing into `packages/fiscal`.
export { createTaxClassificationReader } from "./tax-classification.read.js";
export type {
  DteIvaAffectation,
  StoredIvaAffectation,
  TaxClassification,
  TaxClassificationReadClient,
  TenantTaxClassificationRow,
} from "./tax-classification.read.js";

export { createCustomerFiscalReader } from "./customer-fiscal.read.js";
export type {
  CustomerFiscalReadClient,
  CustomerFiscalRow,
  FiscalOperationType,
} from "./customer-fiscal.read.js";

// The CSC read returns RESTRICTED material. Its shape is the credential port's,
// and nothing that consumes it may log, serialize or echo the value.
export { createFiscalCscReader } from "./fiscal-csc.reader.js";
export type {
  FiscalCsc,
  FiscalCscPort,
  FiscalCscReadClient,
  FiscalCscReadRow,
  FiscalCscReaderArgs,
} from "./fiscal-csc.reader.js";
