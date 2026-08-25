import { createServer, type Server, type Socket } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { RedisHealthService } from "./redis-health.service.js";

/**
 * Minimal RESP server answering every complete command line with +PONG.
 *
 * Replies are generated per parsed command (buffer split on CRLF), not per
 * TCP data event: ioredis batches its handshake commands (CLIENT SETINFO,
 * INFO) into single segments and stalls if it receives fewer replies than
 * commands.
 */
function attachSocketTracking(server: Server): Set<Socket> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return sockets;
}

async function startPongServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let separator = buffer.indexOf("\r\n");
      while (separator !== -1) {
        buffer = buffer.slice(separator + 2);
        socket.write("+PONG\r\n");
        separator = buffer.indexOf("\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("unexpected server address");
  }
  attachSocketTracking(server);
  return { server, port: address.port };
}

describe("RedisHealthService", () => {
  const openedServers: Server[] = [];
  const trackedSockets: Set<Socket>[] = [];

  afterAll(async () => {
    for (let index = openedServers.length - 1; index >= 0; index -= 1) {
      const server = openedServers[index];
      // Force-drop lingering client sockets so close() resolves instead of
      // waiting on half-open connections the OS has not reaped yet.
      const sockets = trackedSockets[index];
      if (sockets) {
        for (const socket of sockets) socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    openedServers.length = 0;
    trackedSockets.length = 0;
  });

  function register(server: Server): void {
    openedServers.push(server);
    trackedSockets.push(attachSocketTracking(server));
  }

  it("reports up when Redis answers PING within the timeout", async () => {
    const { server, port } = await startPongServer();
    register(server);

    const service = new RedisHealthService(`redis://127.0.0.1:${port}`);
    try {
      await expect(service.ping(1000)).resolves.toBe(true);
      // Second ping reuses the established connection.
      await expect(service.ping(1000)).resolves.toBe(true);
    } finally {
      service.onApplicationShutdown("test");
    }
  });

  it("reports down without throwing when the port refuses connections", async () => {
    // Port 1 on loopback is closed in this environment → immediate refusal.
    const service = new RedisHealthService("redis://127.0.0.1:1");
    try {
      await expect(service.ping(500)).resolves.toBe(false);
    } finally {
      service.onApplicationShutdown("test");
    }
  });

  it("reports down when Redis accepts the socket but never answers", async () => {
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    register(silent);
    const address = silent.address();
    if (address === null || typeof address === "string") {
      throw new Error("unexpected server address");
    }

    const service = new RedisHealthService(`redis://127.0.0.1:${address.port}`);
    try {
      await expect(service.ping(120)).resolves.toBe(false);
    } finally {
      service.onApplicationShutdown("test");
    }
  });

  it("survives shutdown even when it never connected", () => {
    const service = new RedisHealthService();
    expect(() => service.onApplicationShutdown("test")).not.toThrow();
  });
});
