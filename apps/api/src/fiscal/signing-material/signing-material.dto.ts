import type { FiscalSigningMaterialView } from "./signing-material.service.js";

export interface SigningMaterialResponse {
  readonly id: string;
  readonly environment: FiscalSigningMaterialView["environment"];
  readonly status: FiscalSigningMaterialView["status"];
  readonly certificateSubject: string;
  readonly certificateSerial: string;
  readonly certificateFingerprintSha256: string;
  readonly keyAlgorithm: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

export interface SigningMaterialListResponse {
  readonly items: SigningMaterialResponse[];
}

export function toSigningMaterialResponse(
  view: FiscalSigningMaterialView
): SigningMaterialResponse {
  return {
    id: view.id,
    environment: view.environment,
    status: view.status,
    certificateSubject: view.certificateSubject,
    certificateSerial: view.certificateSerial,
    certificateFingerprintSha256: view.certificateFingerprintSha256,
    keyAlgorithm: view.keyAlgorithm,
    notBefore: view.notBefore.toISOString(),
    notAfter: view.notAfter.toISOString(),
    createdAt: view.createdAt.toISOString(),
    retiredAt: view.retiredAt?.toISOString() ?? null,
  };
}
