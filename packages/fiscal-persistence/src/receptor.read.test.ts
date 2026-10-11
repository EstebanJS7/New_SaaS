/**
 * FISC-015 WU-D — the customer's rows to `DteReceptor`.
 *
 * The suite is written against the SOURCES: §22.11's field conditions and its
 * validations (last set by NT 023, NT 010, NT 020 and NT 021/024), §21.3's types
 * (`tRuc`, `tDVer`, `tdNombre`, `tdNumDocId`), §21.5's `tiNatRec`/`tiTiOpe`/
 * `tiTipCont` and the protocol tables this unit added. Every case asserts the
 * WHERE clause too, because the tenant is part of the identity: a foreign
 * customer id must be indistinguishable from an absent one.
 */

import type { Prisma, PrismaService } from "@newsaas/database";
import { DteCatalogueError } from "@newsaas/fiscal";
import { describe, expect, it } from "vitest";
import {
  createReceptorReader,
  ReceptorReadError,
  type CustomerAddressCountryRow,
  type CustomerReceptorRow,
  type ReceptorReadArgs,
  type ReceptorReadClient,
  type ReceptorRefusal,
} from "./receptor.read.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_A = "33333333-3333-4333-8333-333333333333";

interface CustomerRow extends CustomerReceptorRow {
  readonly tenantId: string;
  readonly id: string;
}
interface AddressRow extends CustomerAddressCountryRow {
  readonly tenantId: string;
  readonly customerId: string;
  readonly isActive: boolean;
}

function customer(overrides: Partial<CustomerReceptorRow> = {}): CustomerRow {
  return {
    tenantId: TENANT_A,
    id: CUSTOMER_A,
    kind: "COMPANY",
    displayName: "Veterinaria Sur",
    legalName: "Veterinaria Sur S.A.",
    taxId: "80012345",
    documentNumber: null,
    fiscalOperationType: "B2B",
    ...overrides,
  };
}

function address(countryCode: string | null, isActive = true): AddressRow {
  return { tenantId: TENANT_A, customerId: CUSTOMER_A, isActive, countryCode };
}

/** Answers from the rows it holds, applying the same filters Prisma would. */
class ScopedReceptorClient implements ReceptorReadClient {
  readonly customerArgs: Prisma.CustomerFindFirstArgs[] = [];
  readonly addressArgs: Prisma.CustomerAddressFindManyArgs[] = [];
  readonly customer: ReceptorReadClient["customer"];
  readonly customerAddress: ReceptorReadClient["customerAddress"];

  constructor(
    private readonly customers: readonly CustomerRow[],
    private readonly addresses: readonly AddressRow[] = []
  ) {
    this.customer = {
      findFirst: (args) => {
        this.customerArgs.push(args);
        const where = args.where ?? {};
        return Promise.resolve(
          this.customers.find(
            (row) =>
              (where.tenantId === undefined || row.tenantId === where.tenantId) &&
              (where.id === undefined || row.id === where.id)
          ) ?? null
        );
      },
    };
    this.customerAddress = {
      findMany: (args) => {
        this.addressArgs.push(args);
        const where = args.where ?? {};
        return Promise.resolve(
          this.addresses.filter(
            (row) =>
              (where.tenantId === undefined || row.tenantId === where.tenantId) &&
              (where.customerId === undefined || row.customerId === where.customerId) &&
              (where.isActive === undefined || row.isActive === where.isActive)
          )
        );
      },
    };
  }
}

/** The refusal a call raises, which is the part a caller branches on. */
async function refusalOf(answer: Promise<unknown>): Promise<ReceptorRefusal> {
  try {
    await answer;
  } catch (error) {
    if (error instanceof ReceptorReadError) {
      return error.refusal;
    }
    throw error;
  }
  throw new Error("expected the call to refuse");
}

function readFrom(
  customers: readonly CustomerRow[],
  addresses: readonly AddressRow[] = [],
  args: Partial<ReceptorReadArgs> = {}
) {
  const client = new ScopedReceptorClient(customers, addresses);
  return {
    client,
    read: () =>
      createReceptorReader(client).readReceptor({
        tenantId: TENANT_A,
        customerId: CUSTOMER_A,
        documentType: 1,
        ...args,
      }),
  };
}

describe("createReceptorReader", () => {
  it("fits the real Prisma client by construction", () => {
    // Compile-time: the delegates take Prisma's own argument types, so
    // `PrismaService` is assignable without a cast.
    const fits: PrismaService extends ReceptorReadClient ? true : never = true;
    expect(fits).toBe(true);
  });

  it("derives a contributor receptor from the customer's own row", async () => {
    const { read } = readFrom([customer()]);

    await expect(read()).resolves.toEqual({
      // D201 / D206 / D207: a taxId makes the receptor a contribuyente and gives
      // it a RUC whose check digit is COMPUTED (módulo 11), never stored.
      //
      // The expected digit is the algorithm's own: `computeCdcCheckDigit`'s
      // PYG example. Note the trap this pins — `certificate-ruc.test.ts` parses
      // the token `RUC80012345-6`, and that `6` is a TOKEN fixture, not a
      // computed digit: módulo 11 over `80012345` answers `0`. The algorithm is
      // the source for a receptor's D207, as it is for the certificate's.
      iNatRec: 1,
      iTiOpe: 1,
      cPaisRec: "PRY",
      dDesPaisRe: "Paraguay",
      iTiContRec: 2,
      dRucRec: "80012345",
      dDVRec: "0",
      dNomRec: "Veterinaria Sur S.A.",
    });
  });

  it("scopes both reads to the tenant, the customer and an active address", async () => {
    const { client, read } = readFrom([customer()], [address(null)]);

    await read();

    // The tenant is part of the identity: the same query with tenant B answers
    // nothing (see the foreign-tenant case below).
    expect(client.customerArgs[0]?.where).toEqual({ tenantId: TENANT_A, id: CUSTOMER_A });
    expect(client.addressArgs[0]?.where).toEqual({
      tenantId: TENANT_A,
      customerId: CUSTOMER_A,
      isActive: true,
    });
  });

  it("never reads a check digit it was given, and refuses one that disagrees", async () => {
    // `customer.taxId` is free text (the API's schema allows 1..32 characters),
    // so the Manual's own `RUC-DV` shape is accepted and the DV is still
    // computed: a stored digit that disagrees is a data defect, not a source.
    await expect(readFrom([customer({ taxId: "80012345-0" })]).read()).resolves.toMatchObject({
      dRucRec: "80012345",
      dDVRec: "0",
    });
    await expect(refusalOf(readFrom([customer({ taxId: "80012345-7" })]).read())).resolves.toBe(
      "TAX_ID_CHECK_DIGIT_MISMATCH"
    );
  });

  it("refuses a taxId the protocol's tRuc cannot carry", async () => {
    // `tRuc` (§21.3): minLength 3, maxLength 8, `[1-9][0-9]*` with an optional
    // trailing DV. The certificate's eleven-digit `RUCXXXXXXXXX-X` form is too
    // long, and a leading zero is not a RUC.
    for (const taxId of ["800123456", "01234567", "12", "", "8001234K"]) {
      await expect(refusalOf(readFrom([customer({ taxId })]).read())).resolves.toBe(
        "INVALID_TAX_ID"
      );
    }
  });

  it("identifies a non-contributor by the document number, whose type it assumes", async () => {
    const { read } = readFrom([
      customer({
        kind: "INDIVIDUAL",
        legalName: null,
        displayName: "María González",
        taxId: null,
        documentNumber: "1234567",
        fiscalOperationType: "B2C",
      }),
    ]);

    await expect(read()).resolves.toEqual({
      iNatRec: 2,
      iTiOpe: 2,
      cPaisRec: "PRY",
      dDesPaisRe: "Paraguay",
      iTiContRec: 1,
      // The schema does not model WHICH document it is, so the read assumes the
      // country's own: 1 = Cédula paraguaya (§22.11). A passport would be a
      // different code and the repository has nothing to tell them apart.
      iTipIDRec: 1,
      dDTipIDRec: "Cédula paraguaya",
      dNumIDRec: "1234567",
      dNomRec: "María González",
    });
  });

  it("refuses a document number the DE's tdNumDocId cannot carry", async () => {
    for (const documentNumber of ["0".repeat(21), "12 345", "AÑ1"]) {
      await expect(
        refusalOf(
          readFrom([customer({ taxId: null, documentNumber, fiscalOperationType: "B2C" })]).read()
        )
      ).resolves.toBe("INVALID_IDENTITY_DOCUMENT");
    }
  });

  it("answers the innominado receptor the Manual's own three annotations describe", async () => {
    const { read } = readFrom([
      customer({ taxId: null, documentNumber: null, fiscalOperationType: "B2C" }),
    ]);

    await expect(read()).resolves.toEqual({
      iNatRec: 2,
      iTiOpe: 2,
      cPaisRec: "PRY",
      dDesPaisRe: "Paraguay",
      iTiContRec: 2,
      // D208 = 5, dNumIDRec = 0 and dNomRec = "Sin Nombre": the Manual's three
      // annotations, verbatim.
      iTipIDRec: 5,
      dDTipIDRec: "Innominado",
      dNumIDRec: "0",
      dNomRec: "Sin Nombre",
    });
  });

  it("refuses an innominado receptor outside B2C", async () => {
    // D208b / 1319 (NT 010) and D208f / 1333 (NT 023): the same condition.
    for (const fiscalOperationType of ["B2B", "B2G", "B2F"] as const) {
      await expect(
        refusalOf(
          readFrom([customer({ taxId: null, documentNumber: null, fiscalOperationType })]).read()
        )
      ).resolves.toBe("INNOMINADO_NOT_B2C");
    }
  });

  it("refuses an innominado receptor on a credit, debit or remission note", async () => {
    // D208e / 1331 (NT 023): C002 = 5, 6 or 7 cannot carry D208 = 5. The
    // remission note (7) refuses earlier, for the address rule, so it is
    // asserted separately below.
    for (const documentType of [5, 6] as const) {
      await expect(
        refusalOf(
          readFrom(
            [customer({ taxId: null, documentNumber: null, fiscalOperationType: "B2C" })],
            [],
            { documentType }
          ).read()
        )
      ).resolves.toBe("INNOMINADO_DOCUMENT_TYPE");
    }
  });

  it("refuses the two cases whose address cannot be built yet", async () => {
    // `D213` is obligatory for a remission note (C002 = 7) and for an exterior
    // operation (D202 = 4 / B2F) and `D219`/`D223` are its dependants (§22.11),
    // and the receptor's city code has no source anywhere in this repository:
    // the Manual's Tabla 2.2 is not profiled, and `customer_address` carries
    // free text (`city`, `state`) rather than the protocol's codes. Refusing is
    // the honest answer — the address cannot be built, so the document must not
    // be either.
    await expect(refusalOf(readFrom([customer()], [], { documentType: 7 }).read())).resolves.toBe(
      "RECEPTOR_ADDRESS_UNAVAILABLE"
    );
    await expect(
      refusalOf(
        readFrom([customer({ fiscalOperationType: "B2F" })], [], { documentType: 1 }).read()
      )
    ).resolves.toBe("RECEPTOR_ADDRESS_UNAVAILABLE");
  });

  it("refuses a receptor the tenant has not classified", async () => {
    const { read } = readFrom([customer({ fiscalOperationType: null })]);

    // DEC-057 Q2 invented no default for iTiOpe: the column is NULLABLE AND NOT
    // DEFAULTED, and issuance refuses rather than deriving one from `kind`.
    await expect(refusalOf(read())).resolves.toBe("OPERATION_TYPE_NOT_DECLARED");
  });

  it("refuses a receptor with no customer row at all", async () => {
    const { client, read } = readFrom([customer()], [], { customerId: null });

    // `Invoice.customerId` is nullable, and a walk-in invoice has no row to
    // declare an operation type on. There is nothing to derive iTiOpe from, so
    // this is a refusal and not a default; the innominado case is reachable
    // through a customer row that carries no identity.
    await expect(refusalOf(read())).resolves.toBe("RECEPTOR_CUSTOMER_ABSENT");
    expect(client.customerArgs).toEqual([]);
  });

  it("does not answer another tenant's customer", async () => {
    const foreign = { ...customer(), tenantId: TENANT_B };
    const { read } = readFrom([foreign], [{ ...address(null), tenantId: TENANT_B }]);

    await expect(refusalOf(read())).resolves.toBe("RECEPTOR_CUSTOMER_ABSENT");
  });

  it("takes the country from the customer's address when it carries one", async () => {
    await expect(readFrom([customer()], [address("ARG")]).read()).resolves.toMatchObject({
      cPaisRec: "ARG",
      dDesPaisRe: "Argentina",
    });
  });

  it("refuses the alpha-2 country this repository stores, and any country it cannot place", async () => {
    // `customer_address.country_code` is validated as ISO 3166 ALPHA-2
    // (`apps/api/src/customers/customer-address.zod.ts` requires exactly two
    // characters) while `cPaisRec` is `paisType`, which is alpha-3. "PY" is a
    // country this repository knows and the protocol does not publish, so the
    // read refuses instead of emitting a code SIFEN cannot place.
    for (const countryCode of ["PY", "XX", "ZZZ"]) {
      await expect(refusalOf(readFrom([customer()], [address(countryCode)]).read())).resolves.toBe(
        "RECEPTOR_COUNTRY_UNSUPPORTED"
      );
    }
  });

  it("refuses two active addresses that disagree on the country", async () => {
    // Nothing in the repository says which address is the receptor's: there is
    // no primary flag, and `label` is free text. Two countries is an ambiguity
    // no source resolves, so it is refused rather than picked.
    await expect(
      refusalOf(readFrom([customer()], [address("ARG"), address("BRA")]).read())
    ).resolves.toBe("RECEPTOR_COUNTRY_AMBIGUOUS");
    // The same country twice is not ambiguous.
    await expect(
      readFrom([customer()], [address("ARG"), address("ARG")]).read()
    ).resolves.toMatchObject({ cPaisRec: "ARG" });
    // An inactive address does not vote.
    await expect(readFrom([customer()], [address("ARG", false)]).read()).resolves.toMatchObject({
      cPaisRec: "PRY",
    });
  });

  it("refuses a name tdNombre cannot carry", async () => {
    // `dNomRec`'s type is `tdNombre`: 4..255 characters. A three-letter name is
    // schema-invalid, and the refusal is the read's honest answer.
    await expect(refusalOf(readFrom([customer({ legalName: "Ana" })]).read())).resolves.toBe(
      "INVALID_RECEPTOR_NAME"
    );
    await expect(
      refusalOf(readFrom([customer({ legalName: "A".repeat(256) })]).read())
    ).resolves.toBe("INVALID_RECEPTOR_NAME");
  });

  it("refuses only the codes it must, and reports a catalogue failure as its own", async () => {
    // A published unit code is not reachable from here; the receptor's catalogue
    // refusals are the country's and the identity type's, and both surface as
    // this read's own refusal so a caller catches one type.
    const { read } = readFrom([customer()], [address("PY")]);
    try {
      await read();
      throw new Error("expected the call to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(ReceptorReadError);
      expect(error).not.toBeInstanceOf(DteCatalogueError);
      expect((error as ReceptorReadError).message).toContain("PY");
    }
  });
});
