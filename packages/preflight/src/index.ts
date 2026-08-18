import net from "node:net";

export interface PreflightOptions {
  postgresHost: string;
  postgresPort: number;
  redisHost: string;
  redisPort: number;
  timeoutMs?: number;
}

export interface PreflightResult {
  postgres: { reachable: boolean; error?: string };
  redis: { reachable: boolean; error?: string };
}

function checkPort(
  host: string,
  port: number,
  timeoutMs = 3_000
): Promise<{ reachable: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        reachable: false,
        error: `Connection to ${host}:${port} timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    socket
      .once("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ reachable: true });
      })
      .once("error", (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ reachable: false, error: error.message });
      });

    socket.connect(port, host);
  });
}

export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  const [postgres, redis] = await Promise.all([
    checkPort(options.postgresHost, options.postgresPort, options.timeoutMs),
    checkPort(options.redisHost, options.redisPort, options.timeoutMs),
  ]);

  return { postgres, redis };
}

export function formatPreflightResult(result: PreflightResult): string {
  const lines: string[] = [];
  lines.push(`PostgreSQL: ${result.postgres.reachable ? "reachable" : "unreachable"}`);
  if (result.postgres.error) lines.push(`  -> ${result.postgres.error}`);
  lines.push(`Redis: ${result.redis.reachable ? "reachable" : "unreachable"}`);
  if (result.redis.error) lines.push(`  -> ${result.redis.error}`);
  return lines.join("\n");
}
