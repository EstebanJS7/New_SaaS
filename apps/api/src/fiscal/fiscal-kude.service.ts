import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "@newsaas/shared";
import { STORAGE_PORT, type StoragePort } from "@newsaas/storage";
import { FiscalService } from "./fiscal.service.js";

export { FISCAL_KUDE_NOT_FOUND_MESSAGE } from "./fiscal.service.js";
/** Stable refusal for an unreadable stored KuDE; the driver's message never reaches the caller. */
export const FISCAL_KUDE_UNREADABLE_MESSAGE = "The KuDE could not be read.";
/** The KuDE is the printable HTML the worker rendered and stored (DEC-098). */
export const FISCAL_KUDE_CONTENT_TYPE = "text/html; charset=utf-8";

export interface FiscalKude {
  readonly body: Buffer;
  readonly filename: string;
}

/**
 * FISC-021 / DEC-098 — serves the KuDE the worker stored when it signed.
 *
 * Gates, tenant scope and the `404`s are {@link FiscalService.findKude}'s; this
 * service only reads the bytes. The KuDE carries the receiver's data
 * (CONFIDENTIAL): its content and its storage key are never logged or returned
 * in an error.
 */
@Injectable()
export class FiscalKudeService {
  constructor(
    private readonly fiscal: FiscalService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort
  ) {}

  async read(id: string): Promise<FiscalKude> {
    const { storageKey, cdc } = await this.fiscal.findKude(id);
    let body: Buffer;
    try {
      body = (await this.storage.get({ key: storageKey })).body;
    } catch {
      throw new DomainError("INTERNAL", FISCAL_KUDE_UNREADABLE_MESSAGE);
    }
    // The CDC is 44 digits; anything else (or none) falls back to the UUID, so the
    // header value never carries a quote or a control character.
    const name = cdc !== null && /^[0-9A-Za-z]+$/.test(cdc) ? cdc : id;
    return { body, filename: `kude-${name}.html` };
  }
}
