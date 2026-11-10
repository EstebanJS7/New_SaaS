import { decodeQuotedPrintable } from "./smtp-sink.js";

/**
 * Just enough MIME to read an attachment off the wire the SMTP sink captured ([[FISC-021]]).
 *
 * The sink keeps the raw DATA — headers and body as the worker's `nodemailer` adapter wrote them —
 * so the lane can check what a recipient actually receives: the part's declared type, its
 * filename, and its bytes after the transfer encoding is undone. It handles the one shape the
 * adapter produces (a `multipart/*` message with leaf parts) and fails loudly on anything else.
 */
export interface MimePart {
  readonly headers: ReadonlyMap<string, string>;
  /** The part's bytes with its `Content-Transfer-Encoding` undone. */
  readonly content: Buffer;
}

export interface MimeAttachment extends MimePart {
  readonly contentType: string;
  readonly filename: string | null;
  readonly transferEncoding: string;
}

const CRLF = "\r\n";

/** Splits a header block into lower-cased names and unfolded values. */
function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  const unfolded = block.replace(/\r\n[ \t]+/g, " ");
  for (const line of unfolded.split(CRLF)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

/** One parameter of a structured header (`boundary`, `filename`, `name`), quoted or bare. */
function parameter(value: string | undefined, name: string): string | null {
  if (value === undefined) return null;
  const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  if (match === null) return null;
  return match[1] ?? match[2] ?? null;
}

function splitHeadersAndBody(raw: string): { headers: Map<string, string>; body: string } {
  const end = raw.indexOf(CRLF + CRLF);
  if (end === -1) return { headers: parseHeaders(raw), body: "" };
  return { headers: parseHeaders(raw.slice(0, end)), body: raw.slice(end + 4) };
}

function decodeBody(body: string, encoding: string): Buffer {
  switch (encoding) {
    case "base64":
      return Buffer.from(body.replace(/\s+/g, ""), "base64");
    case "quoted-printable":
      return Buffer.from(decodeQuotedPrintable(body), "latin1");
    case "7bit":
    case "8bit":
    case "binary":
    case "":
      return Buffer.from(body, "latin1");
    default:
      throw new Error(`Unsupported Content-Transfer-Encoding: ${encoding}`);
  }
}

/** Every leaf part of a raw `multipart/*` message, in order. */
export function mimeParts(raw: string): MimePart[] {
  const { headers, body } = splitHeadersAndBody(raw);
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/")) {
    throw new Error(`The message is not multipart; its Content-Type is "${contentType}".`);
  }
  const boundary = parameter(contentType, "boundary");
  if (boundary === null) throw new Error("The multipart message declares no boundary.");

  const parts: MimePart[] = [];
  const delimiter = `--${boundary}`;
  const sections = body.split(delimiter).slice(1);
  for (const section of sections) {
    if (section.startsWith("--")) break;
    // A section starts with the CRLF after the delimiter and ends with the CRLF before the next.
    const trimmed = section.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const part = splitHeadersAndBody(trimmed);
    const partType = part.headers.get("content-type") ?? "text/plain";
    if (partType.toLowerCase().startsWith("multipart/")) {
      parts.push(...mimeParts(trimmed));
      continue;
    }
    const encoding = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
    parts.push({ headers: part.headers, content: decodeBody(part.body, encoding) });
  }
  return parts;
}

/** The parts that carry a filename — what a mail client lists as attachments. */
export function mimeAttachments(raw: string): MimeAttachment[] {
  return mimeParts(raw).flatMap((part) => {
    const disposition = part.headers.get("content-disposition");
    const contentType = part.headers.get("content-type") ?? "";
    const filename = parameter(disposition, "filename") ?? parameter(contentType, "name");
    if (filename === null) return [];
    return [
      {
        ...part,
        contentType,
        filename,
        transferEncoding: (part.headers.get("content-transfer-encoding") ?? "").toLowerCase(),
      },
    ];
  });
}
