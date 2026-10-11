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

// FISC-015 WU-D: the receptor. The customer's rows to the `DteReceptor` the
// mapper consumes — derived where the sources pin it (módulo 11 for the RUC's
// check digit, `kind` for the taxpayer type, `taxId`/`documentNumber` for the
// identity) and REFUSED where they do not (a missing operation type, an
// innominado receptor outside B2C, an address the remission and exterior cases
// require, a country code this repository stores as alpha-2).
export { createReceptorReader, ReceptorReadError } from "./receptor.read.js";
export type {
  CustomerAddressCountryRow,
  CustomerReceptorRow,
  ReceptorReadArgs,
  ReceptorReadClient,
  ReceptorRefusal,
  StoredCustomerKind,
} from "./receptor.read.js";

// FISC-015 WU-D: the confirmed invoice and its lines to the mapper's own
// `ConfirmedInvoiceSnapshot`. It composes WU-C's classification read for each
// line's treatment, resolves `dDesMoneOpe` and `dDesUniMed` from the protocol's
// own tables in `@newsaas/fiscal`, and refuses a line whose rate code the tenant
// has not classified, a unit it has not declared, and an `E737` NT 013's formula
// cannot express exactly.
export { createInvoiceSnapshotReader, InvoiceSnapshotReadError } from "./invoice-snapshot.read.js";
export type {
  DecimalColumn,
  InvoiceItemRow,
  InvoiceLineSnapshotRow,
  InvoiceRateRow,
  InvoiceSnapshotReadArgs,
  InvoiceSnapshotReadClient,
  InvoiceSnapshotRefusal,
  InvoiceSnapshotRow,
} from "./invoice-snapshot.read.js";

// FISC-015 WU-B: the authorisation a confirmed invoice's fiscal number came from
// (DEC-056). Its consumer is the worker's assembly, which must not need to know
// whether the number came from a timbrado range or from Billing's counter — the
// counter path is answered as `null`.
export { createInvoiceAllocationReader } from "./invoice-allocation.read.js";
export type {
  InvoiceAllocationReadClient,
  InvoiceFiscalAllocation,
  InvoiceFiscalAllocationRow,
} from "./invoice-allocation.read.js";

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
