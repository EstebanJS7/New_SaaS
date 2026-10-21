import { describe, expect, it } from "vitest";
import type { CreateCustomerInput } from "@newsaas/customers";
import { detectSuspectedDuplicate } from "./duplicates.js";
import type { DuplicateLookup } from "./duplicates.js";
import type { CustomerRowContact } from "./customer-row.js";

interface LookupCalls {
  readonly documents: string[];
  readonly contacts: { kind: "PHONE" | "EMAIL"; value: string }[];
}

function makeLookup(matches: {
  documentNumbers?: readonly string[];
  contactValues?: readonly string[];
}): { lookup: DuplicateLookup; calls: LookupCalls } {
  const calls: LookupCalls = { documents: [], contacts: [] };

  return {
    calls,
    lookup: {
      existsByDocumentNumber: (value) => {
        calls.documents.push(value);
        return matches.documentNumbers?.includes(value) ?? false;
      },
      existsByContactValue: (kind, value) => {
        calls.contacts.push({ kind, value });
        return matches.contactValues?.includes(value) ?? false;
      },
    },
  };
}

const INDIVIDUAL_WITH_DOCUMENT: CreateCustomerInput = {
  kind: "INDIVIDUAL",
  displayName: "Ana Pérez",
  documentNumber: "DOC-1",
};

const INDIVIDUAL_WITHOUT_DOCUMENT: CreateCustomerInput = {
  kind: "INDIVIDUAL",
  displayName: "Beto",
};

const COMPANY: CreateCustomerInput = {
  kind: "COMPANY",
  displayName: "Vet Co SA",
  legalName: "Vet Co SA",
  taxId: "80012345-6",
};

const PHONE_CONTACT: CustomerRowContact = { kind: "PHONE", value: "0981123456", isPrimary: true };
const EMAIL_CONTACT: CustomerRowContact = {
  kind: "EMAIL",
  value: "ana@example.com",
  isPrimary: true,
};

/**
 * The heuristic ([[DEC-069]]): a warning, computed from an injected lookup, with
 * no query and no tenant of its own.
 */
describe("detectSuspectedDuplicate", () => {
  it("reports a match on the document number, before it looks at a contact", () => {
    const { lookup, calls } = makeLookup({ documentNumbers: ["DOC-1"] });

    expect(detectSuspectedDuplicate([PHONE_CONTACT], INDIVIDUAL_WITH_DOCUMENT, lookup)).toBe(true);
    expect(calls.documents).toEqual(["DOC-1"]);
    expect(calls.contacts).toEqual([]);
  });

  it("reports a match on a contact value when the row carries no document number", () => {
    const { lookup, calls } = makeLookup({ contactValues: ["0981123456"] });

    expect(detectSuspectedDuplicate([PHONE_CONTACT], INDIVIDUAL_WITHOUT_DOCUMENT, lookup)).toBe(
      true
    );
    expect(calls.documents).toEqual([]);
    expect(calls.contacts).toEqual([{ kind: "PHONE", value: "0981123456" }]);
  });

  it("reports a match on an e-mail contact value", () => {
    const { lookup } = makeLookup({ contactValues: ["ana@example.com"] });

    expect(detectSuspectedDuplicate([EMAIL_CONTACT], INDIVIDUAL_WITHOUT_DOCUMENT, lookup)).toBe(
      true
    );
  });

  it("reports no match when neither the document nor a contact is known", () => {
    const { lookup } = makeLookup({});

    expect(
      detectSuspectedDuplicate([PHONE_CONTACT, EMAIL_CONTACT], INDIVIDUAL_WITH_DOCUMENT, lookup)
    ).toBe(false);
  });

  it("does not ask about a document number the row does not carry", () => {
    const { lookup, calls } = makeLookup({ documentNumbers: ["DOC-1"] });

    expect(detectSuspectedDuplicate([], COMPANY, lookup)).toBe(false);
    expect(calls.documents).toEqual([]);
  });

  it("reports no match for a row with neither a document number nor a contact", () => {
    const { lookup, calls } = makeLookup({ documentNumbers: ["DOC-1"] });

    expect(detectSuspectedDuplicate([], INDIVIDUAL_WITHOUT_DOCUMENT, lookup)).toBe(false);
    expect(calls.contacts).toEqual([]);
  });
});
