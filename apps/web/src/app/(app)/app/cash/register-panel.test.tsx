import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ApiRequestError,
  CASH_FEATURE_NOT_ENTITLED_MESSAGE,
  CASH_REGISTER_NAME_CONFLICT_MESSAGE,
  type CashRegister,
  type CreateCashRegisterInput,
} from "./cash-api";
import { RegisterPanel } from "./register-panel";

const REGISTER: CashRegister = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Front desk",
  isActive: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

interface PanelOverrides {
  readonly registers?: readonly CashRegister[];
  readonly isLoading?: boolean;
  readonly loadError?: Error | null;
  readonly onCreate?: (input: CreateCashRegisterInput) => Promise<void>;
  readonly isCreating?: boolean;
  readonly createError?: Error | null;
  readonly created?: CashRegister | null;
}

function renderPanel(overrides: PanelOverrides = {}): {
  readonly onCreate: ReturnType<typeof vi.fn>;
} {
  const onCreate = vi.fn((_input: CreateCashRegisterInput) => Promise.resolve());
  render(
    <RegisterPanel
      registers={overrides.registers ?? []}
      isLoading={overrides.isLoading ?? false}
      loadError={overrides.loadError ?? null}
      onCreate={overrides.onCreate ?? onCreate}
      isCreating={overrides.isCreating ?? false}
      createError={overrides.createError ?? null}
      created={overrides.created ?? null}
    />
  );
  return { onCreate };
}

describe("RegisterPanel states", () => {
  it("shows a loading state before the API answers", () => {
    renderPanel({ isLoading: true });

    expect(screen.getByTestId("registers-loading")).toHaveTextContent("Loading cash registers...");
    expect(screen.queryByTestId("registers-empty")).not.toBeInTheDocument();
  });

  it("shows an empty state when the tenant has no registers", () => {
    renderPanel();

    expect(screen.getByTestId("registers-empty")).toHaveTextContent("No cash registers yet.");
  });

  it("renders the permission-denied branch when the read is refused", () => {
    renderPanel({ loadError: new ApiRequestError("FORBIDDEN", "Access denied.", 403) });

    const alert = screen.getByTestId("registers-error");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage cash registers.");
  });

  it("renders the entitlement-denied branch when the tenant lacks the capability", () => {
    renderPanel({
      loadError: new ApiRequestError(
        "FEATURE_NOT_ENTITLED",
        CASH_FEATURE_NOT_ENTITLED_MESSAGE,
        403
      ),
    });

    expect(screen.getByTestId("registers-error")).toHaveTextContent(
      "Cash features are not enabled for this tenant"
    );
  });

  it("lists the API's registers", () => {
    renderPanel({ registers: [REGISTER, { ...REGISTER, id: "other", name: "Back office" }] });

    expect(screen.getByText("Front desk")).toBeInTheDocument();
    expect(screen.getByText("Back office")).toBeInTheDocument();
    expect(screen.queryByTestId("registers-empty")).not.toBeInTheDocument();
  });

  it("shows a success state only from the created register the API returned", () => {
    renderPanel({ created: REGISTER });

    const status = screen.getByTestId("register-created");
    expect(status).toHaveTextContent("Register created");
    expect(status).toHaveTextContent('"Front desk" now exists for this tenant.');
  });
});

describe("RegisterPanel create form", () => {
  it("labels its single field visibly", () => {
    renderPanel();

    expect(screen.getByLabelText("Register name")).toHaveValue("");
  });

  it("refuses a blank name locally and never calls the API", () => {
    const { onCreate } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Create register" }));

    expect(screen.getByTestId("register-name-error")).toHaveTextContent(
      "A cash register name is required."
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("sends the trimmed name alone and clears the field after a confirmed create", async () => {
    const { onCreate } = renderPanel();

    fireEvent.change(screen.getByLabelText("Register name"), {
      target: { value: "  Front desk  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create register" }));

    expect(onCreate).toHaveBeenCalledWith({ name: "Front desk" });
    expect(await screen.findByLabelText("Register name")).toHaveValue("");
  });

  it("keeps the entered name when the API refuses the create", async () => {
    const onCreate = vi.fn((_input: CreateCashRegisterInput) => Promise.reject(new Error("no")));
    renderPanel({ onCreate, createError: new Error("no") });

    fireEvent.change(screen.getByLabelText("Register name"), { target: { value: "Front desk" } });
    fireEvent.click(screen.getByRole("button", { name: "Create register" }));

    expect(await screen.findByLabelText("Register name")).toHaveValue("Front desk");
  });

  it("surfaces the duplicate-name 409 as its own outcome", () => {
    renderPanel({
      createError: new ApiRequestError("CONFLICT", CASH_REGISTER_NAME_CONFLICT_MESSAGE, 409),
    });

    expect(screen.getByTestId("register-create-error")).toHaveTextContent(
      "A cash register with this name already exists"
    );
  });

  it("surfaces the stable 400 validation refusal", () => {
    renderPanel({
      createError: new ApiRequestError(
        "VALIDATION_FAILED",
        "Invalid cash register create body.",
        400
      ),
    });

    expect(screen.getByTestId("register-create-error")).toHaveTextContent(
      "The request was rejected as invalid"
    );
  });

  it("surfaces the permission and entitlement refusals distinctly", () => {
    renderPanel({ createError: new ApiRequestError("FORBIDDEN", "Access denied.", 403) });
    expect(screen.getByTestId("register-create-error")).toHaveTextContent("Permission denied");
  });

  it("blocks the field and relabels the button while the create is in flight", () => {
    renderPanel({ isCreating: true });

    expect(screen.getByLabelText("Register name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Creating register..." })).toBeDisabled();
  });
});
