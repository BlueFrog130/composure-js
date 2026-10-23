// `/about` (what composurejs is, and what this bot runs) and `/invite` (install links).
import { Button, Permission, Row, Separator, Text } from "composurejs";
import composurejs from "../../../packages/composurejs/package.json" with { type: "json" };
import { command, EVERYWHERE, repoUrl } from "./env.ts";
import * as ui from "./ui.tsx";

declare const __GIT_SHA__: string | undefined;
/** The commit built, from vite.config.ts; "dev" under Vitest and `composure sync`. */
export const GIT_SHA = typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : "dev";
/** The composurejs this bot runs: the workspace's. */
export const COMPOSURE_VERSION = composurejs.version;

const GUIDE = "https://bluefrog130.github.io/composure-js/";

/** What the bot asks for when added to a server: following the announcement channel creates a webhook. */
export const INSTALL_PERMISSIONS = Permission.ManageWebhooks;

export const about = command({
  name: "about",
  description: "About composurejs and this bot",
  ...EVERYWHERE,
  handler: (c) => {
    const repo = repoUrl(c.data.config);
    return (
      <ui.Primary>
        <Text>## composurejs</Text>
        <Text>
          A TypeScript framework for Discord bots that answer over HTTP only (no gateway), on Cloudflare Workers, Node or Bun. This bot is built with it and runs on Workers:
          `/changelog`, `/docs`, `/package` and `/notify` are its own source in `bots/composure`.
        </Text>
        <Text>-# Its Rust sibling, composure-rs, has a bot of its own with the same Commands; Discord labels each with its app.</Text>
        <Separator />
        <Text>
          -# Running composurejs {COMPOSURE_VERSION} at [`{GIT_SHA}`]({repo}/commit/{GIT_SHA})
        </Text>
        <Row>
          <Button url={GUIDE}>Guide</Button>
          <Button url={repo}>GitHub</Button>
          <Button url="https://www.npmjs.com/package/composurejs">npm</Button>
          <Button url="https://github.com/BlueFrog130/composure-rs">composure-rs</Button>
        </Row>
      </ui.Primary>
    );
  },
});

export const invite = command({
  name: "invite",
  description: "Add this bot to a server, or to your apps to use it anywhere",
  ...EVERYWHERE,
  handler: (c) => {
    const base = `https://discord.com/oauth2/authorize?client_id=${c.interaction.application_id}`;
    return (
      <ui.Primary>
        <Text>## Add composurejs</Text>
        <Text>**To a server**: release announcements with `/notify`, and every command for everyone there.</Text>
        <Text>**To your apps**: `/changelog`, `/docs`, `/package` and more in any server or DM.</Text>
        <Row>
          <Button url={`${base}&scope=bot+applications.commands&permissions=${INSTALL_PERMISSIONS}&integration_type=0`}>Add to a server</Button>
          <Button url={`${base}&scope=applications.commands&integration_type=1`}>Add to my apps</Button>
        </Row>
      </ui.Primary>
    );
  },
});
