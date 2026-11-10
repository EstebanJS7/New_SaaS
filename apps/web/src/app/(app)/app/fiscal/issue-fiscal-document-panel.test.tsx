import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ApiRequestError,
  FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE,
  type FiscalDocument,
} from "./fiscal-api";
import { IssueFiscalDocumentPanel } from "./issue-fiscal-document-panel";
const DOCUMENT: FiscalDocument = {
  id: "99999999-9999-4999-8999-999999999999",
  invoiceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider: "TEST",
  status: "QUEUED",
  attemptCount: 0,
  externalId: null,
  cdc: null,
  lastErrorCode: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
  cancelledAt: null,
  hasKude: false,
};
function renderPanel(overrides: Partial<Parameters<typeof IssueFiscalDocumentPanel>[0]> = {}) {
  const onIssue = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <IssueFiscalDocumentPanel
      onIssue={onIssue}
      isIssuing={false}
      issueError={null}
      issued={null}
      {...overrides}
    />
  );
  return { onIssue, unmount: result.unmount };
}
describe("IssueFiscalDocumentPanel", () => {
  it("validates required and malformed invoice ids", () => {
    const { onIssue } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Emitir documento fiscal" }));
    expect(screen.getByTestId("fiscal-invoice-id-error")).toHaveTextContent(
      "Ingresá el identificador de la factura."
    );
    fireEvent.change(screen.getByLabelText("Identificador de la factura"), {
      target: { value: "invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir documento fiscal" }));
    expect(screen.getByTestId("fiscal-invoice-id-error")).toHaveTextContent(
      "debe ser un UUID válido"
    );
    expect(onIssue).not.toHaveBeenCalled();
  });
  it("issues with only the invoice id and disables while pending", () => {
    const { onIssue, unmount } = renderPanel();
    const invoiceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    fireEvent.change(screen.getByLabelText("Identificador de la factura"), {
      target: { value: invoiceId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir documento fiscal" }));
    expect(onIssue).toHaveBeenCalledWith({ invoiceId });
    unmount();
    renderPanel({ isIssuing: true });
    expect(screen.getByRole("button", { name: "Emitiendo documento fiscal…" })).toBeDisabled();
  });
  it("shows the issued representation and API error", () => {
    const { unmount } = renderPanel({ issued: DOCUMENT });
    expect(screen.getByTestId("fiscal-issued")).toHaveTextContent("con estado «En cola»");
    unmount();
    renderPanel({
      issueError: new ApiRequestError("CONFLICT", FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE, 409),
    });
    expect(screen.getByTestId("fiscal-issue-error")).toHaveTextContent(
      "Ya se emitió un documento fiscal para esta factura."
    );
    expect(screen.getByTestId("fiscal-issue-error")).not.toHaveTextContent(
      FISCAL_DOCUMENT_ALREADY_ISSUED_MESSAGE
    );
  });
});
