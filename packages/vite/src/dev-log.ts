// How the plugin logs in `vite dev`: through Vite's logger, each line tagged `[composure]`.
import type { Logger } from "vite";

/** Prefixes every line the plugin logs in `vite dev`. */
export const TAG = "\x1b[36m[composure]\x1b[0m";

/** Where the Dev Loop's stages log. */
export interface DevLog {
  info(message: string): void;
  warn(message: string): void;
}

/** Vite's logger, tagged and timestamped. */
export function devLog(logger: Logger): DevLog {
  return {
    info: (msg) => logger.info(`${TAG} ${msg}`, { timestamp: true }),
    warn: (msg) => logger.warn(`${TAG} ${msg}`, { timestamp: true }),
  };
}
