import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

/**
 * Widen React Testing Library's async utility window.
 *
 * The web suite runs dozens of jsdom files. Even with `fileParallelism: false`
 * (see vitest.config.ts) the machine can be busy enough — a CI runner, another
 * local test run, a build — that a worker is descheduled for seconds at a time.
 * RTL's default `asyncUtilTimeout` of 1000 ms is calibrated for an idle
 * machine, so under that pressure `findBy*`/`waitFor` can expire while the
 * awaited work is still correct, failing a test whose assertions are sound.
 *
 * `4000` is four times the default (enough to absorb multi-second scheduling
 * gaps) and stays below Vitest's default 5000 ms `testTimeout`, so a genuinely
 * missing element still fails with RTL's own diagnostic ("Unable to find ...")
 * instead of being pre-empted by the runner's opaque test timeout.
 *
 * This tolerates starvation; it does not remove it. A real absence now takes up
 * to four seconds to fail instead of one, and starvation lasting longer than
 * four seconds can still surface as a flake.
 */
configure({ asyncUtilTimeout: 4000 });
