// The bot's Env: wrangler.jsonc's vars and secrets, the KV binding, and the Bot Data built from them
// once per isolate. Handlers reach the outside world only through Bot Data (`c.data.store`,
// `c.data.http`), so tests swap both for stand-ins.
import { createFactory, fetchTransport, type Transport } from "composurejs";

/** A key-value store of strings: Workers KV's `KV` binding, a map in tests. */
export interface Store {
  get(key: string): Promise<string | null>;
  /** `expirationTtl` in seconds; Workers KV's shortest is 60. */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Bindings {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  ANNOUNCE_CHANNEL_ID?: string;
  FEEDBACK_CHANNEL_ID?: string;
  LOG_CHANNEL_ID?: string;
  KV: Store;
}

/** Where the bot posts and what it reads. */
export interface Config {
  /** `owner/name` of the GitHub repository whose releases are announced (`GITHUB_REPO`). */
  repo: string;
  /** Read-only token for the GitHub API (`GITHUB_TOKEN`); unauthenticated requests share Workers' IPs and their 60 an hour. */
  githubToken: string | undefined;
  /** The home server's announcement channel releases are posted to and followed from. */
  announceChannel: string;
  /** Private channel `/feedback` posts to. */
  feedbackChannel: string;
  /** Private channel installs are logged to. */
  logChannel: string;
}

/** Bot Data: `c.data`. */
export interface Data {
  config: Config;
  store: Store;
  /** Requests to GitHub and npm. */
  http: Transport;
}

export type BotEnv = { Bindings: Bindings; Data: Data };

/** The repository when `GITHUB_REPO` is unset. */
export const DEFAULT_REPO = "BlueFrog130/composure-js";

/** The Config from vars by name; throws naming the first missing or malformed one. */
export function readConfig(vars: Record<string, unknown>): Config {
  const id = (name: string): string => {
    const value = vars[name];
    if (typeof value !== "string" || value === "") throw new Error(`${name} is not set`);
    if (!/^\d{17,20}$/.test(value)) throw new Error(`${name} is not a snowflake`);
    return value;
  };
  const text = (name: string) => (typeof vars[name] === "string" && vars[name] !== "" ? (vars[name] as string) : undefined);
  return {
    repo: text("GITHUB_REPO") ?? DEFAULT_REPO,
    githubToken: text("GITHUB_TOKEN"),
    announceChannel: id("ANNOUNCE_CHANNEL_ID"),
    feedbackChannel: id("FEEDBACK_CHANNEL_ID"),
    logChannel: id("LOG_CHANNEL_ID"),
  };
}

/** The App's `data` loader, also used by the cron trigger. */
export function loadData(env: Bindings): Data {
  return { config: readConfig(env as unknown as Record<string, unknown>), store: env.KV, http: fetchTransport };
}

export const repoUrl = (config: Config) => `https://github.com/${config.repo}`;

export const { app: createApp, command, group, messageCommand } = createFactory<BotEnv>();

/** Every Command but `/notify` works in servers, DMs and group DMs, installed to a server or to a user. */
export const EVERYWHERE = {
  contexts: ["guild", "botDm", "privateChannel"],
  integrationTypes: ["guildInstall", "userInstall"],
} as const;
