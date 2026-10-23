// The Dev Loop (ADR 0031): in `vite dev`, opens the Tunnel, points the Dev Application's endpoint
// at it (Repoint), and syncs Commands to the dev guild on start and whenever the code changes.
// Serving the App is another plugin's: `server()`, or `@cloudflare/vite-plugin`.
import type { AddressInfo } from "node:net";
import type { Transport } from "composurejs";
import type { Plugin, ViteDevServer } from "vite";
import { devLog } from "./dev-log.ts";
import { startDevSync } from "./dev-sync.ts";
import { envFileWithToken, secretsOf, viteEnv } from "./env.ts";
import { repoint } from "./repoint.ts";
import { describeFailure, elapsed } from "./stage.ts";
import { type Tunnel, tunnelFor, type TunnelOption } from "./tunnel.ts";

/**
 * The Dev Loop's settings, all here: nothing is read from the environment but the secrets
 * `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY` and `CLOUDFLARE_TUNNEL_TOKEN` (Vite's env files for the
 * mode, e.g. `.env.local`, under the process environment).
 */
export interface DevOptions {
  /**
   * The Dev Application's id: the only application whose interactions endpoint is pointed at the
   * tunnel, and only when it is `DISCORD_TOKEN`'s. Unset: the URL to set by hand is printed.
   */
  application?: string;
  /** dev Sync's guild: Commands are synced there on start and on every change. Unset: no dev Sync. */
  guild?: string;
  /** Which tunnel to open. Default `"quick"`. See {@link TunnelOption}. */
  tunnel?: TunnelOption;
  /** Tests only: REST requests to Discord. Under Vitest the Dev Loop runs only with this set. */
  transport?: Transport;
}

/**
 * Sets the Tunnel, Repoint and dev Sync up on a dev server. `appFile`: the module exporting the
 * App. `hoist` makes the plugin dev Sync loads the App with.
 */
export function setupDevLoop(server: ViteDevServer, dev: DevOptions, appFile: string, hoist: () => Plugin): void {
  const log = devLog(server.config.logger);
  const secrets = secretsOf(viteEnv(server.config));
  // Vite loads `.env` in every mode, so a production token left there reaches `vite dev`.
  if (envFileWithToken(server.config)) {
    log.warn(".env sets DISCORD_TOKEN, and Vite loads .env in every mode: keep the Dev Application's secrets in .env.local and production's in .env.production.local.");
  }

  if (dev.guild) startDevSync(server, { ...log, guild: dev.guild, token: secrets.token, transport: dev.transport, appFile, plugin: hoist });

  const setup = tunnelFor(dev.tunnel);
  if (!setup) return;
  let tunnel: Tunnel | undefined;
  let closed = false;
  // Only once the server listens: the tunnel needs its port, and Discord PINGs a new endpoint.
  server.httpServer?.once("listening", () => {
    const since = Date.now();
    void (async () => {
      const { port } = server.httpServer!.address() as AddressInfo;
      tunnel = await setup.open({ ...log, port, root: server.config.root, tunnelToken: secrets.tunnelToken });
      if (closed) return void tunnel.close();
      log.info(`tunnel connected ${tunnel.url} (${elapsed(since)})`);
      await repoint({ ...log, tunnel, application: dev.application, token: secrets.token, publicKey: secrets.publicKey, transport: dev.transport, since });
    })().catch((error: unknown) => log.warn(describeFailure(error)));
  });
  server.httpServer?.once("close", () => {
    closed = true;
    void tunnel?.close();
  });
}
