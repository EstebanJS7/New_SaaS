import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApiRequestError, type FiscalDocument } from "./fiscal-api";
import { FiscalDetailPanel } from "./fiscal-detail-panel";
const DOCUMENT: FiscalDocument = {
  id: "99999999-9999-4999-8999-999999999999",
  invoiceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider: "TEST",
  status: "PENDING",
  attemptCount: 2,
  externalId: null,
  cdc: null,
  lastErrorCode: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
  cancelledAt: null,
  hasKude: false,
};
function renderPanel(overrides: Partial<Parameters<typeof FiscalDetailPanel>[0]> = {}) {
  const onCancel = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <FiscalDetailPanel
      document={DOCUMENT}
      isLoading={false}
      loadError={null}
      onCancel={onCancel}
      isCancelling={false}
      cancelError={null}
      outcome={null}
      {...overrides}
    />
  );
  return { onCancel, unmount: result.unmount };
}
describe("FiscalDetailPanel", () => {
  it("renders loading, no-selection and error branches", () => {
    const { unmount } = renderPanel({ document: null, isLoading: true });
    expect(screen.getByTestId("fiscal-detail-loading")).toBeInTheDocument();
    unmount();
    renderPanel({ document: null });
    expect(screen.getByTestId("fiscal-no-selection")).toBeInTheDocument();
    unmount();
    renderPanel({ loadError: new ApiRequestError("NOT_FOUND", "Missing", 404) });
    expect(screen.getByTestId("fiscal-detail-error")).toHaveTextContent(
      "No encontramos el documento fiscal"
    );
  });
  it("shows the allowlisted representation and explicit null placeholders", () => {
    renderPanel();
    expect(screen.getByTestId("fiscal-status")).toHaveTextContent("Pendiente");
    expect(screen.getByTestId("fiscal-provider")).toHaveTextContent("TEST");
    expect(screen.getByTestId("fiscal-attempt-count")).toHaveTextContent("2");
    expect(screen.getByTestId("fiscal-external-id")).toHaveTextContent("No informado");
    expect(screen.getByTestId("fiscal-cdc")).toHaveTextContent("No informado");
    expect(screen.getByTestId("fiscal-last-error-code")).toHaveTextContent("No informado");
    expect(screen.getByTestId("fiscal-created-at")).toBeInTheDocument();
    expect(screen.getByTestId("fiscal-updated-at")).toBeInTheDocument();
  });
  it("validates and submits cancellation, then disables while pending", () => {
    const { onCancel, unmount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar documento fiscal" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("fiscal-cancel-validation-error")).toBeInTheDocument();
    unmount();
    renderPanel({ isCancelling: true });
    expect(screen.getByRole("button", { name: "Cancelando documento fiscal…" })).toBeDisabled();
    expect(screen.getByLabelText("Motivo de la cancelación")).toBeDisabled();
  });
  it("hides cancellation for sending and cancelled states and renders API conflict verbatim", () => {
    const { unmount } = renderPanel({ document: { ...DOCUMENT, status: "SENDING" } });
    expect(screen.queryByLabelText("Motivo de la cancelación")).not.toBeInTheDocument();
    unmount();
    renderPanel({ document: { ...DOCUMENT, status: "CANCELLED" } });
    expect(screen.queryByLabelText("Motivo de la cancelación")).not.toBeInTheDocument();
  });
  it("offers «Ver KuDE» in a new tab when the document has a KuDE (FISC-021)", () => {
    renderPanel({ document: { ...DOCUMENT, status: "APPROVED", hasKude: true } });
    const link = screen.getByRole("link", { name: "Ver KuDE" });
    expect(link).toHaveAttribute("href", `/api/fiscal/fiscal-documents/${DOCUMENT.id}/kude`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("offers «Ver KuDE» for a credit note's document too (FISC-021)", () => {
    renderPanel({
      document: {
        ...DOCUMENT,
        status: "APPROVED",
        creditNoteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        hasKude: true,
      },
    });
    expect(screen.getByRole("link", { name: "Ver KuDE" })).toHaveAttribute(
      "href",
      `/api/fiscal/fiscal-documents/${DOCUMENT.id}/kude`
    );
  });
  it("does not offer «Ver KuDE» when the document has no KuDE (FISC-021)", () => {
    renderPanel({ document: { ...DOCUMENT, status: "APPROVED", hasKude: false } });
    expect(screen.queryByRole("link", { name: "Ver KuDE" })).not.toBeInTheDocument();
  });
});
