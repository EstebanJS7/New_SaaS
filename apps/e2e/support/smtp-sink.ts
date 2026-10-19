import { createServer, type Server, type Socket } from "node:net";

/**
 * A minimal SMTP server, because the recovery lane has to READ THE MAIL.
 *
 * There is no other honest way. The channel fake retains attempts in memory and deliberately never
 * logs a recipient; the delivery row does not hold the message, because content is built at send time;
 * and a plaintext reset token is never stored anywhere, by design. So the only place the link exists
 * between the worker and the user is on the wire — and this is the wire.
 *
 * It is deliberately small: it answers EHLO, MAIL FROM, RCPT TO, DATA and QUIT, advertises nothing
 * (no AUTH, no STARTTLS), and captures the message body. It also exercises the REAL `nodemailer`
 * adapter, which the channel fake cannot.
 */
/**
 * The port the lane's one worker sends to, and the port the recovery sink listens on.
 *
 * One worker serves both recovery flows, so they share one port: the single spec file opens the sink
 * once, and a send only ever happens in response to a request it made.
 */
export const SMTP_SINK_PORT = 2526;

export interface CapturedMessage {
  readonly from: string;
  readonly recipients: readonly string[];
  /** The raw body, as it came off the wire — quoted-printable, so decode before reading it. */
  readonly body: string;
}

export interface SmtpSink {
  readonly port: number;
  /** Resolves with the next message, or rejects when the timeout passes. */
  nextMessage(timeoutMs?: number): Promise<CapturedMessage>;
  close(): Promise<void>;
}

const CRLF = "\r\n";

export async function startSmtpSink(port: number): Promise<SmtpSink> {
  const received: CapturedMessage[] = [];
  const waiting: {
    resolve: (message: CapturedMessage) => void;
    reject: (error: Error) => void;
  }[] = [];

  function deliver(message: CapturedMessage): void {
    const next = waiting.shift();
    if (next === undefined) {
      received.push(message);
      return;
    }
    next.resolve(message);
  }

  const sockets = new Set<Socket>();

  const server: Server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    let body = "";
    let from = "";
    let recipients: string[] = [];

    const write = (line: string): void => {
      socket.write(`${line}${CRLF}`);
    };

    write("220 newsaas-e2e ESMTP");

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      for (;;) {
        const end = buffer.indexOf(CRLF);
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + CRLF.length);

        if (inData) {
          // The end of the body is a line holding a single dot, which is also how a dot-stuffed line
          // starting with one is told apart from it.
          if (line === ".") {
            inData = false;
            deliver({ from, recipients, body });
            body = "";
            recipients = [];
            from = "";
            write("250 2.0.0 Ok: queued");
            continue;
          }
          body += `${line.startsWith("..") ? line.slice(1) : line}${CRLF}`;
          continue;
        }

        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) {
          // One advertised capability, and nothing a client can negotiate with: no AUTH, no STARTTLS.
          write("250-newsaas-e2e");
          write("250 SIZE 10485760");
        } else if (command.startsWith("MAIL FROM")) {
          from = line.slice(line.indexOf(":") + 1).trim();
          write("250 2.1.0 Ok");
        } else if (command.startsWith("RCPT TO")) {
          recipients = [...recipients, line.slice(line.indexOf(":") + 1).trim()];
          write("250 2.1.5 Ok");
        } else if (command.startsWith("DATA")) {
          inData = true;
          write("354 End data with <CR><LF>.<CR><LF>");
        } else if (command.startsWith("AUTH")) {
          // Accepted so the sink works whether or not a client decides to authenticate. It advertises
          // no AUTH, so a client that respects that never gets here.
          write("235 2.7.0 Authentication successful");
        } else if (command.startsWith("QUIT")) {
          write("221 2.0.0 Bye");
          socket.end();
        } else {
          // RSET, NOOP and anything else a client tries: acknowledged, because this sink is not the
          // subject of the test.
          write("250 2.0.0 Ok");
        }
      }
    });

    socket.on("error", () => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    port,
    nextMessage(timeoutMs = 30_000) {
      const queued = received.shift();
      if (queued !== undefined) return Promise.resolve(queued);

      return new Promise<CapturedMessage>((resolve, reject) => {
        const waiter = {
          resolve: (message: CapturedMessage) => {
            clearTimeout(timer);
            resolve(message);
          },
          reject: (error: Error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        const timer = setTimeout(() => {
          // THE BUG THAT MADE THE PORTAL'S SPEC FAIL: the timeout rejected the caller but LEFT ITS
          // WAITER IN THE QUEUE, so the next message was handed to a promise nobody could observe. The
          // caller that was actually waiting then timed out as well, and the message was gone — "the
          // first recovery flow passes and the second one hangs", which is exactly what happened.
          const index = waiting.indexOf(waiter);
          if (index !== -1) waiting.splice(index, 1);
          reject(
            new Error(
              `No message arrived at the SMTP sink within ${timeoutMs}ms. The worker did not send one: ` +
                "check that it is running with EMAIL_PROVIDER=smtp and that the API enqueued a delivery."
            )
          );
        }, timeoutMs);
        waiting.push(waiter);
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        // A closed sink will never deliver, and a caller left hanging is worse than a caller told so.
        for (const waiter of waiting.splice(0)) {
          waiter.reject(new Error("The SMTP sink was closed before a message arrived."));
        }
        // An idle connection would keep `server.close` waiting for the rest of the run.
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      });
    },
  };
}

/**
 * Decodes quoted-printable, which is what a mail transport uses and what a reader never sees.
 *
 * Without this step the link is there but unreadable: `=` arrives as `=3D` and long lines arrive
 * broken with a soft `=\r\n`. A lane that parsed the raw body would find no link and report the wrong
 * failure.
 */
export function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
}

/** The recovery link a message carries, or a failure that says what WAS there. */
export function resetLinkIn(rawBody: string, path: string): string {
  const decoded = decodeQuotedPrintable(rawBody);
  // The body is wrapped for transport, so a URL can be split across lines by soft breaks only —
  // which the decode above already removed. Whitespace inside the URL is still stripped defensively.
  const match = new RegExp(`https?://[^\\s"<>]*${path}[^\\s"<>]*`).exec(decoded);
  if (match === null) {
    throw new Error(`No ${path} link in the message. Decoded body was:\n${decoded.slice(0, 800)}`);
  }
  return match[0].replace(/&amp;/g, "&");
}
