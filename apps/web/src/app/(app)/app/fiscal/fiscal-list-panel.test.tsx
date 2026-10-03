import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApiRequestError, type FiscalDocument } from "./fiscal-api";
import { FiscalListPanel } from "./fiscal-list-panel";

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
function renderPanel(overrides: Partial<Parameters<typeof FiscalListPanel>[0]> = {}) {
  const onSelectDocument = vi.fn();
  const onStatusFilterChange = vi.fn();
  render(
    <FiscalListPanel
      documents={[DOCUMENT]}
      isLoading={false}
      loadError={null}
      statusFilter="ALL"
      onStatusFilterChange={onStatusFilterChange}
      selectedDocumentId={null}
      onSelectDocument={onSelectDocument}
      {...overrides}
    />
  );
  return { onSelectDocument, onStatusFilterChange };
}
describe("FiscalListPanel", () => {
  it("renders loading, empty and error states", () => {
    const { unmount } = render(
      <FiscalListPanel
        documents={[]}
        isLoading={true}
        loadError={null}
        statusFilter="ALL"
        onStatusFilterChange={vi.fn()}
        selectedDocumentId={null}
        onSelectDocument={vi.fn()}
      />
    );
    expect(screen.getByTestId("fiscal-list-loading")).toBeInTheDocument();
    unmount();
    renderPanel({ documents: [] });
    expect(screen.getByTestId("fiscal-list-empty")).toBeInTheDocument();
    unmount();
    renderPanel({ loadError: new ApiRequestError("FORBIDDEN", "Denied", 403) });
    expect(screen.getByTestId("fiscal-list-error")).toHaveTextContent("Permission denied");
  });
  it("renders API values and reports filter and selection changes", () => {
    const { onSelectDocument, onStatusFilterChange } = renderPanel();
    const row = screen.getByTestId("fiscal-list-item");
    expect(row).toHaveTextContent("Pending");
    expect(row).toHaveTextContent("2 attempts");
    expect(row).toHaveTextContent("2026-10-01 08:00 UTC");
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "APPROVED" } });
    expect(onStatusFilterChange).toHaveBeenCalledWith("APPROVED");
    fireEvent.click(screen.getByRole("button", { name: "Select document" }));
    expect(onSelectDocument).toHaveBeenCalledWith(DOCUMENT);
  });
  it("marks the selected row", () => {
    renderPanel({ selectedDocumentId: DOCUMENT.id });
    expect(screen.getByTestId("fiscal-list-item")).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
