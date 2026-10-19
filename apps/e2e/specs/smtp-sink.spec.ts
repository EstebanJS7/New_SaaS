import { connect } from "node:net";
import { expect, test } from "@playwright/test";
import {
  decodeQuotedPrintable,
  resetLinkIn,
  startSmtpSink,
  type SmtpSink,
} from "../support/smtp-sink.js";

/**
 * The sink, tested on its own.
 *
 * It is the most delicate file in this lane — a minimal SMTP server, written for the recovery flows —
 * and it had NO tests, which is how it hid the bug that made the portal's recovery spec fail in
 * sequence: it delivered the FIRST message and silently swallowed the second.
 *
 * No browser here: these are assertions about a TCP protocol, and Playwright's runner is a perfectly
 * good place for them.
 */
const PORT = 2529;

/** A message sent over the wire, the way a mail client does it. */
async function sendMail(args: { from: string; to: string; body: string }): Promise<void> {
  const socket = connect(PORT, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  // Resolve on the sink's own confirmation ("queued"), not on the socket closing: waiting for `close`
  // depends on when a FIN arrives relative to the last write, and that is the kind of thing a test
  // should not be measuring. The 250 after the terminating dot is the protocol's answer.
  const queued = new Promise<void>((resolve, reject) => {
    socket.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Ok: queued")) resolve();
    });
    socket.once("error", reject);
  });

  const lines = [`EHLO test`, `MAIL FROM:<${args.from}>`, `RCPT TO:<${args.to}>`, "DATA"];
  for (const line of lines) socket.write(`${line}\r\n`);
  for (const line of args.body.split("\n")) socket.write(`${line}\r\n`);
  socket.write(".\r\n");

  await queued;
  socket.destroy();
}

test.describe("the SMTP sink", () => {
  let sink: SmtpSink;

  test.beforeEach(async () => {
    sink = await startSmtpSink(PORT);
  });

  test.afterEach(async () => {
    await sink.close();
  });

  test("captures a message, with its envelope and its body", async () => {
    const pending = sink.nextMessage(5_000);
    await sendMail({ from: "a@test", to: "b@test", body: "Subject: hi\n\nhello" });

    const message = await pending;
    expect(message.from).toContain("a@test");
    expect(message.recipients.join(" ")).toContain("b@test");
    expect(message.body).toContain("hello");
  });

  test("captures the message that arrives BEFORE anyone is waiting", async () => {
    await sendMail({ from: "a@test", to: "b@test", body: "early" });

    const message = await sink.nextMessage(5_000);
    expect(message.body).toContain("early");
  });

  test("captures TWO messages in a row", async () => {
    // The plain case the lane needs: two flows, two messages.
    const first = sink.nextMessage(5_000);
    await sendMail({ from: "a@test", to: "first@test", body: "one" });
    expect((await first).body).toContain("one");

    const second = sink.nextMessage(5_000);
    await sendMail({ from: "a@test", to: "second@test", body: "two" });
    expect((await second).body).toContain("two");
  });

  test("does NOT swallow the message that follows a TIMED-OUT wait", async () => {
    // THE BUG. A timeout rejected the caller but left its waiter in the queue, so the next message was
    // delivered to a promise nobody could observe: the caller that was actually waiting timed out too,
    // and the message was gone. In the lane that is "the first recovery flow passes and the second one
    // hangs", which is exactly what happened.
    await expect(sink.nextMessage(50)).rejects.toThrow(/No message arrived/);

    const pending = sink.nextMessage(5_000);
    await sendMail({ from: "a@test", to: "after@test", body: "after the timeout" });

    expect((await pending).body).toContain("after the timeout");
  });

  test("rejects a waiter when it is closed, instead of leaving it hanging", async () => {
    const pending = sink.nextMessage(30_000);
    await sink.close();

    await expect(pending).rejects.toThrow(/closed/i);
  });
});

test.describe("reading what the sink captured", () => {
  test("decodes quoted-printable, which is what the transport uses", () => {
    // `=` arrives as `=3D`, and a long line is broken by a soft `=\r\n`.
    expect(decodeQuotedPrintable("a=3Db")).toBe("a=b");
    // An `=` travels as `=3D`. A bare `=ab` would be a HEX escape and decoding it is correct, which
    // is why a realistic body never contains one.
    expect(decodeQuotedPrintable("http://x/reset?token=3Dabc-123_XYZ")).toBe(
      "http://x/reset?token=abc-123_XYZ"
    );
    expect(decodeQuotedPrintable("one=\r\ntwo")).toBe("onetwo");
  });

  test("finds the recovery link in a wrapped body", () => {
    const body = [
      "Subject: reset",
      "",
      "Follow this:",
      "http://127.0.0.1:3000/reset-password?token=3DAbC-123_xyz",
    ].join("\r\n");

    expect(resetLinkIn(body, "/reset-password")).toBe(
      "http://127.0.0.1:3000/reset-password?token=AbC-123_xyz"
    );
  });

  test("says what it saw when there is no link", () => {
    expect(() => resetLinkIn("nothing here", "/reset-password")).toThrow(
      /No \/reset-password link/
    );
  });
});
