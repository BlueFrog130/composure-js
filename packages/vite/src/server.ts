// The Default Server (ADR 0024): node:http in Web Request/Response, tracked Background Work,
// graceful shutdown, GET /health. Runs on Node and Bun. `vite build` for `node` / `bun` wraps the
// App in it unless the plugin's `entry` names a server entry of your own, which can import these.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type App, type BindingsOf, createTracker, type Env, MAX_BODY_BYTES, type Tracker } from "composurejs";

/** Default time Background Work gets to finish on shutdown (ADR 0007). */
export const SHUTDOWN_GRACE_MS = 30_000;

export interface ServeOptions<E extends Env> {
  /** Default `PORT` from the environment, else 3000; 0 picks a free port. */
  port?: number;
  hostname?: string;
  /** Env passed to the App. Default `process.env`. */
  env?: BindingsOf<E>;
  /** How long shutdown waits for Background Work, in ms. Default 30s. */
  shutdownGrace?: number;
  /** Close gracefully on SIGTERM/SIGINT. Default true. */
  handleSignals?: boolean;
  /** Path answering `GET` with 200 for health checks, or false. Default `/health`. */
  healthPath?: string | false;
}

export interface RunningServer {
  readonly server: Server;
  /** Where the server listens, e.g. `http://127.0.0.1:3000`. */
  readonly url: string;
  readonly platform: Tracker;
  /** Stops accepting requests and waits for Background Work, up to the grace period. */
  close(): Promise<void>;
}

/** Serves an App over node:http. Resolves once listening. */
export async function serve<E extends Env>(app: App<E>, options: ServeOptions<E> = {}): Promise<RunningServer> {
  const {
    port = Number(process.env.PORT ?? 3000),
    hostname,
    env = process.env as BindingsOf<E>,
    shutdownGrace = SHUTDOWN_GRACE_MS,
    handleSignals = true,
    healthPath = "/health",
  } = options;
  const platform = createTracker();

  const server = createServer((req, res) => {
    if (healthPath && req.method === "GET" && req.url === healthPath) {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    toRequest(req)
      .then(
        async (request) => send(res, request ? await app.fetch(request, env, platform) : new Response("Payload Too Large", { status: 413 })),
        () => send(res, new Response("Bad Request", { status: 400 })),
      )
      .catch(() => res.destroy());
  });

  await new Promise<void>((resolve) => server.listen(port, hostname, resolve));
  const address = server.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await platform.settle(shutdownGrace);
    })());
  if (handleSignals) onShutdown(close);

  return { server, url: `http://${host}:${address.port}`, platform, close };
}

/** The Web Request for `req`, or undefined when its body is over the cap. */
export async function toRequest(req: IncomingMessage): Promise<Request | undefined> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  if (req.method === "GET" || req.method === "HEAD") return new Request(url, { method: req.method, headers });

  // Stop buffering past the cap, but keep draining so the response can be written.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) return undefined;
  return new Request(url, { method: req.method ?? "POST", headers, body: Buffer.concat(chunks) });
}

/** Writes a Web Response to a node:http response. */
export async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name] = value));
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Runs `close` on the first SIGTERM or SIGINT, then re-raises the signal so the process ends
 * as it would have. Returns a function removing the listeners.
 */
export function onShutdown(close: () => Promise<void>): () => void {
  const signals = ["SIGTERM", "SIGINT"] as const;
  const handler = (signal: NodeJS.Signals) => {
    remove();
    void close().finally(() => process.kill(process.pid, signal));
  };
  const remove = () => signals.forEach((s) => process.off(s, handler));
  signals.forEach((s) => process.once(s, handler));
  return remove;
}

/** The App a module exports as `app` or default. */
export function appOf<A extends { fetch: unknown; definitions: unknown } = App>(module: Record<string, unknown>, file: string): A {
  const app = [module.app, module.default].find((v) => typeof (v as A | undefined)?.fetch === "function" && typeof (v as A).definitions === "function");
  if (!app) throw new Error(`${file} must export the App as \`app\` or as its default export`);
  return app as A;
}
