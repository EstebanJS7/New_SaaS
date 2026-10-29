"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const DocumentNonce = createContext<{ nonce: string | undefined } | null>(null);

/** CSP belongs to the initial document, not to subsequent RSC navigation requests. */
export function DocumentNonceProvider({
  nonce,
  children,
}: {
  nonce?: string;
  children: ReactNode;
}) {
  const [documentNonce] = useState(nonce);
  return (
    <DocumentNonce.Provider value={{ nonce: documentNonce }}>{children}</DocumentNonce.Provider>
  );
}

/** Only receives the existing server-validated theme CSS; never accepts tenant CSS. */
export function BrandStyle({ css, nonce }: { css: string; nonce?: string }) {
  const document = useContext(DocumentNonce);
  return (
    <style
      nonce={document === null ? nonce : document.nonce}
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
