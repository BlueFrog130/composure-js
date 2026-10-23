// What Discord, GitHub and npm hold for a test: one Transport that answers all three by URL and
// records every request, and the Bot Data the handlers get (a map for KV, that Transport for HTTP).
import { DISCORD_API, type Transport } from "composurejs";
import { TEST_GUILD_ID, testUser } from "composurejs/testing";
import type { Config, Data } from "../src/env.ts";

export const NEWS = "300000000000000002";
export const ANNOUNCE = "600000000000000001";
export const FEEDBACK = "600000000000000002";
export const LOG = "600000000000000003";
export const POSTED = "700000000000000001";

export const config: Config = { repo: "BlueFrog130/composure-js", githubToken: "gh-token", announceChannel: ANNOUNCE, feedbackChannel: FEEDBACK, logChannel: LOG };

const release = (tag: string, at: string, body: string, draft = false, prerelease = false) => ({
  tag_name: tag,
  name: tag,
  draft,
  prerelease,
  published_at: at,
  body,
  html_url: `https://github.com/BlueFrog130/composure-js/releases/tag/${encodeURIComponent(tag)}`,
});

export const githubReleases = [
  release("composurejs@0.2.0-rc.1", "2026-10-21T10:00:00Z", "### Minor Changes\n\nSoon", false, true),
  release("composurejs@0.3.0", "2026-10-22T10:00:00Z", "draft", true),
  release("@composurejs/vite@0.1.2", "2026-10-20T17:05:03Z", "### Patch Changes\n\n- Another package"),
  release("composurejs@0.1.2", "2026-10-20T17:05:02Z", "## Features\n\n### Faster cold starts\n\nWorkers compile\neach function lazily."),
  release("composurejs@0.1.1", "2026-10-20T15:09:25Z", "## Fixes\n\n### Deferred update errors"),
  release("composurejs@0.1.0", "2026-10-20T14:20:53Z", "## Features\n\n### Commands defined once"),
];

export const message = (id: string, channel: string) => ({
  id,
  channel_id: channel,
  author: testUser,
  content: "",
  timestamp: "2026-10-20T00:00:00.000000+00:00",
  edited_timestamp: null,
  tts: false,
  mention_everyone: false,
  mentions: [],
  mention_roles: [],
  attachments: [],
  embeds: [],
  pinned: false,
  type: 0,
});

export const follower = (id: string, channel: string) => ({
  id,
  type: 2,
  guild_id: TEST_GUILD_ID,
  channel_id: channel,
  name: "Composure #js-releases",
  avatar: null,
  application_id: null,
  source_guild: { id: "1", name: "Composure", icon: null },
  source_channel: { id: ANNOUNCE, name: "js-releases" },
});

export interface Sent {
  method: string;
  /** The path after Discord's API base, or the whole URL elsewhere. */
  path: string;
  headers: Headers;
  json: unknown;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export class World {
  readonly sent: Sent[] = [];
  /** This guild's webhooks. */
  readonly webhooks: unknown[] = [];
  /** Answer webhook requests with 403. */
  forbidden = false;
  readonly kv = new Map<string, string>();

  readonly fetch: Transport = async (request) => {
    const url = request.url;
    const path = url.startsWith(DISCORD_API) ? url.slice(DISCORD_API.length) : url;
    const text = await request.text();
    this.sent.push({ method: request.method, path, headers: request.headers, json: text ? JSON.parse(text) : undefined });
    return this.#answer(request.method, path);
  };

  #answer(method: string, path: string): Response {
    if (path.startsWith("https://api.github.com/")) return json(200, githubReleases);
    if (path.startsWith("https://registry.npmjs.org/")) {
      return json(200, { description: "HTTP-only Discord bots", "dist-tags": { latest: "0.1.2", next: "0.2.0-rc.1" }, time: { "0.1.2": "2026-10-20T17:05:02.000Z" } });
    }
    if (path.startsWith("https://api.npmjs.org/downloads/point/")) return json(200, { downloads: path.includes("last-month") ? 12345 : 678 });
    // Interaction webhooks (/webhooks/<application>/<token>) are not the guild's
    const webhooks = path.includes("/webhooks") && !path.startsWith("/webhooks/1052");
    if (webhooks && this.forbidden) return json(403, { message: "Missing Permissions", code: 50013 });
    if (method === "GET" && path === `/guilds/${TEST_GUILD_ID}/webhooks`) return json(200, this.webhooks);
    if (method === "POST" && path.endsWith("/followers")) return json(200, { channel_id: ANNOUNCE, webhook_id: "800000000000000009" });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (method === "POST" && path === "/users/@me/channels") return json(200, { id: "77", type: 1 });
    if (method === "POST" && path.startsWith("/channels/")) return json(200, message(POSTED, path.split("/")[2]!));
    return json(200, {});
  }

  /** The Bot Data handlers get. */
  get data(): Data {
    return {
      config,
      http: this.fetch,
      store: {
        get: async (key) => this.kv.get(key) ?? null,
        put: async (key, value) => void this.kv.set(key, value),
      },
    };
  }

  /** Requests to `prefix` (Discord paths start with `/`). */
  to(prefix: string): Sent[] {
    return this.sent.filter((s) => s.path.startsWith(prefix));
  }
}
