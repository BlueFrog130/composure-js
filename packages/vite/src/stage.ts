// The Dev Loop's stages (tunnel, probe, endpoint, ...): each has its own limit, and a failure names
// its stage and the last thing it observed (ADR 0031).

/** A Dev Loop stage that failed. Logged as `<stage> failed: <message>`. */
export class StageError extends Error {
  override name = "StageError";
  constructor(
    readonly stage: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Runs one stage: `run` reports what it sees with `observe` and stops when `signal` aborts. Past
 * `ms` it fails with `no <waitingFor> within <s>s (last: <observation>)`; any other failure is
 * wrapped to name the stage. A result that comes after the limit goes to `late` (to close it).
 */
export async function withinLimit<T>(
  stage: string,
  ms: number,
  waitingFor: string,
  run: (observe: (what: string) => void, signal: AbortSignal) => Promise<T>,
  late?: (value: T) => void,
): Promise<T> {
  const controller = new AbortController();
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new StageError(stage, `no ${waitingFor} within ${ms / 1000}s${last ? ` (last: ${last})` : ""}`));
    }, ms);
  });
  const work = run((what) => void (last = what), controller.signal);
  work.then(
    (value) => {
      if (timedOut) late?.(value);
    },
    () => {},
  );
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    throw error instanceof StageError ? error : new StageError(stage, (error as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/** Seconds since `since`, as `8.1s`. */
export const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

/** How a Dev Loop failure is logged. */
export const describeFailure = (error: unknown) =>
  error instanceof StageError ? `${error.stage} failed: ${error.message}` : `Dev Loop failed: ${(error as Error).message ?? String(error)}`;
