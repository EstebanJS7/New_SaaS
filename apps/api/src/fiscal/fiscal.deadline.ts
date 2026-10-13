/**
 * The deadline discipline both provider-facing commands share.
 *
 * A hung provider must never turn an operator's command into an unbounded open
 * request, so the call is raced against a timer that, when it fires, abandons the
 * call (the signal is aborted) and answers the caller's time-out result. Two
 * commands need exactly this: FISC-016 WU-C's cancellation and WU-D's range void.
 * The implementation lives here rather than in either command so the two cannot
 * drift, and `cancelWithinDeadline` — which the cancellation's own suite pins —
 * is the first command's named use of it.
 *
 * The timer is always cleared, so a fast provider leaves no pending handle
 * behind.
 */

export interface DeadlineArgs<T> {
  /** The provider call. It receives the signal the deadline aborts. */
  readonly call: (signal: AbortSignal) => Promise<T>;
  readonly deadlineMs: number;
  /**
   * The result the caller is answered with when the deadline fires. It is the
   * caller's, because its outcome vocabulary and reason code are the command's:
   * a cancellation and a void phrase a time-out in their own terms.
   */
  readonly onTimeout: () => T;
}

export async function runWithinDeadline<T>(args: DeadlineArgs<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(args.onTimeout());
    }, args.deadlineMs);
  });
  try {
    return await Promise.race([args.call(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
