/**
 * Rejects with a descriptive timeout error when the wrapped operation does
 * not settle within {@link timeoutMs}.
 *
 * The losing operation gets a no-op rejection handler attached so its late
 * failure cannot surface as an unhandled promise rejection after the race
 * has already resolved.
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const guarded = operation();
  guarded.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      guarded,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Dependency '${label}' timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
