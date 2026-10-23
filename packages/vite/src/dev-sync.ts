// dev Sync (ADR 0031, unchanged from 0017): in `vite dev`, the App's Commands are synced to the
// dev guild on start and after each source change. Independent of the Tunnel.
import type { Transport } from "composurejs";
import { BotClient, getCurrentApplication } from "composurejs/rest";
import { apply, plan, summary } from "composurejs/sync";
import { type Plugin, runnerImport, type ViteDevServer } from "vite";
import type { DevLog } from "./dev-log.ts";
import { appOf } from "./server.ts";

export interface DevSyncOptions extends DevLog {
  /** The guild Commands are synced to. */
  guild: string;
  /** `DISCORD_TOKEN`: its application is the one synced. */
  token: string | undefined;
  /** Tests only: REST requests to Discord. */
  transport?: Transport | undefined;
  /** The module exporting the App. */
  appFile: string;
  /** A fresh `composure()` the App is loaded with. */
  plugin(): Plugin;
}

/** Debounces source changes into one Sync. */
const DEBOUNCE = 300;

/**
 * Starts dev Sync on a dev server: now, then after source changes. The Definitions are read
 * through Vite like the build (a Workers bot's App runs in workerd, out of reach), and sent only
 * when they differ from the last synced. A failure is logged; the server keeps running.
 */
export function startDevSync(server: ViteDevServer, options: DevSyncOptions): void {
  const { guild, token, appFile, plugin, info, warn } = options;
  const rest = options.transport ? { transport: options.transport } : {};
  let applicationId: string | undefined;
  let last = "";
  let running: Promise<void> = Promise.resolve();
  const syncNow = () =>
    (running = running.then(async () => {
      if (!token) return warn("dev Sync needs DISCORD_TOKEN (in .env.local).");
      try {
        // The token's application: runs are serialized, so this is fetched once.
        applicationId ??= (await getCurrentApplication(new BotClient(token, rest))).id;
        const config = { token, applicationId, scopes: {}, guild };
        const { module } = await runnerImport<Record<string, unknown>>(appFile, { root: server.config.root, plugins: [plugin()], logLevel: "error" });
        const definitions = appOf(module, appFile).definitions();
        const key = JSON.stringify(definitions);
        if (key === last) return;
        const planned = await plan(definitions, config, rest);
        await apply(planned, config, rest);
        last = key;
        info(`dev Sync to guild ${guild}: ${summary(planned)}`);
      } catch (error) {
        warn(`dev Sync failed: ${(error as Error).message}`);
      }
    }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  server.watcher.on("change", (file) => {
    if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes("node_modules")) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, DEBOUNCE);
  });
  server.httpServer?.once("close", () => clearTimeout(timer));
  void syncNow();
}
