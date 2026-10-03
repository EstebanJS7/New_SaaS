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
      "Fiscal document not found"
    );
  });
  it("shows the allowlisted representation and explicit null placeholders", () => {
    renderPanel();
    expect(screen.getByTestId("fiscal-status")).toHaveTextContent("Pending");
    expect(screen.getByTestId("fiscal-provider")).toHaveTextContent("TEST");
    expect(screen.getByTestId("fiscal-attempt-count")).toHaveTextContent("2");
    expect(screen.getByTestId("fiscal-external-id")).toHaveTextContent("Not provided");
    expect(screen.getByTestId("fiscal-cdc")).toHaveTextContent("Not provided");
    expect(screen.getByTestId("fiscal-last-error-code")).toHaveTextContent("Not provided");
    expect(screen.getByTestId("fiscal-created-at")).toBeInTheDocument();
    expect(screen.getByTestId("fiscal-updated-at")).toBeInTheDocument();
  });
  it("validates and submits cancellation, then disables while pending", () => {
    const { onCancel, unmount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Cancel fiscal document" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("fiscal-cancel-validation-error")).toBeInTheDocument();
    unmount();
    renderPanel({ isCancelling: true });
    expect(screen.getByRole("button", { name: "Cancelling fiscal document..." })).toBeDisabled();
    expect(screen.getByLabelText("Cancellation reason")).toBeDisabled();
  });
  it("hides cancellation for sending and cancelled states and renders API conflict verbatim", () => {
    const { unmount } = renderPanel({ document: { ...DOCUMENT, status: "SENDING" } });
    expect(screen.queryByLabelText("Cancellation reason")).not.toBeInTheDocument();
    unmount();
    renderPanel({ document: { ...DOCUMENT, status: "CANCELLED" } });
    expect(screen.queryByLabelText("Cancellation reason")).not.toBeInTheDocument();
  });
});
