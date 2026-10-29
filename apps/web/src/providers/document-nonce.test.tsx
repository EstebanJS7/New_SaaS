import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandStyle, DocumentNonceProvider } from "./document-nonce";

describe("document-scoped brand style nonce", () => {
  it("keeps the initial document nonce while a route supplies a different request nonce", () => {
    const { container, rerender } = render(
      <DocumentNonceProvider nonce="initial-document">
        <BrandStyle nonce="first-route" css=":root{--primary:173 80% 28%;}" />
      </DocumentNonceProvider>
    );
    expect(container.querySelector("style")).toHaveAttribute("nonce", "initial-document");
    rerender(
      <DocumentNonceProvider nonce="new-rsc-request">
        <BrandStyle nonce="new-rsc-request" css=":root{--primary:200 50% 40%;}" />
      </DocumentNonceProvider>
    );
    expect(container.querySelector("style")).toHaveAttribute("nonce", "initial-document");
    expect(container.querySelector("style")?.textContent).toContain("200 50% 40%");
  });
  it("supports an independently server-rendered layout without a root provider", () => {
    const { container } = render(<BrandStyle nonce="ssr-request" css=":root{--radius:0.75rem;}" />);
    expect(container.querySelector("style")).toHaveAttribute("nonce", "ssr-request");
  });
});
