// The starter templates: one generator, so the three targets share their App, tests and docs and
// differ only where the platform does. CI generates each and runs its typecheck, tests and build
// (scripts/check-templates.mjs).

export type Template = "cloudflare" | "node" | "bun";

export const TEMPLATES: Record<Template, { label: string; hint: string }> = {
  cloudflare: { label: "Cloudflare Workers", hint: "vite dev on workerd, wrangler deploy" },
  node: { label: "Node", hint: "one self-contained dist/index.js" },
  bun: { label: "Bun", hint: "one self-contained dist/index.js for bun" },
};

/** Versions the generated package.json depends on. */
export interface Versions {
  composurejs: string;
  vite: string;
  cli: string;
  vitePlugin: string;
}

/** The Dev Loop's ids, written literally into `vite.config.ts`'s `dev` (ADR 0031). */
export interface DevIds {
  /** The Dev Application's id. */
  application?: string;
  /** dev Sync's guild id. */
  guild?: string;
}

export type Files = Record<string, string>;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Every file of a new bot named `name` for `template`. */
export function generate(template: Template, name: string, versions: Versions, dev: DevIds = {}): Files {
  const files: Files = {
    "package.json": json(packageJson(template, name, versions)),
    "tsconfig.json": json({
      compilerOptions: {
        target: "es2023",
        module: "preserve",
        moduleResolution: "bundler",
        lib: ["es2023", "dom", "dom.iterable"],
        types: template === "cloudflare" ? [] : ["node"],
        jsx: "react-jsx",
        jsxImportSource: "composurejs",
        strict: true,
        noUncheckedIndexedAccess: true,
        verbatimModuleSyntax: true,
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["src", "test", "*.config.ts"],
    }),
    "vite.config.ts": viteConfig(template, dev),
    "vitest.config.ts": `// Tests compile Inline Handlers like the build, without the platform plugins.
import composure from "@composurejs/vite"
import { defineConfig } from "vitest/config"

export default defineConfig({ plugins: [composure()] })
`,
    "src/app.tsx": APP,
    "src/counter.tsx": COUNTER,
    "test/app.test.ts": TEST,
    ".gitignore": ["node_modules/", "dist/", ".env", ".env.*", "!.env.example", ".wrangler/", ""].join("\n"),
    ".env.example": ENV_EXAMPLE,
    "README.md": readme(template, name),
    ...entry(template, name),
  };
  return files;
}

function packageJson(template: Template, name: string, v: Versions) {
  const scripts: Record<string, string> = {
    dev: "vite",
    build: "vite build",
    test: "vitest run",
    typecheck: "tsc",
    sync: "composure sync",
  };
  // start reads production's secrets only: bun would otherwise load .env.local too.
  if (template === "cloudflare") scripts.deploy = "vite build && wrangler deploy";
  else scripts.start = template === "node" ? "node --env-file-if-exists=.env.production.local dist/index.js" : "bun --env-file=.env.production.local dist/index.js";

  const devDependencies: Record<string, string> = {
    "@composurejs/cli": v.cli,
    "@composurejs/vite": v.vitePlugin,
    typescript: "^7.0.2",
    vite: v.vite,
    vitest: "^5.0.5",
  };
  if (template === "cloudflare") Object.assign(devDependencies, { "@cloudflare/vite-plugin": "^1.64.0", wrangler: "^4.151.3" });
  else devDependencies["@types/node"] = "^26.6.5";
  const dependencies: Record<string, string> = { composurejs: v.composurejs };
  return { name, private: true, type: "module", scripts, dependencies, devDependencies };
}

const DEV_COMMENT = `  // dev: the Dev Loop in \`vite dev\`. application: your Dev Application's id, whose Interactions
  // Endpoint URL is pointed at the tunnel. guild: the test server Commands sync to on every change.`;

function composureCall(dev: DevIds): string {
  const fields = (["application", "guild"] as const).filter((key) => dev[key]).map((key) => `${key}: ${JSON.stringify(dev[key])}`);
  return `composure({ dev: ${fields.length > 0 ? `{ ${fields.join(", ")} }` : "{}"} })`;
}

function viteConfig(template: Template, dev: DevIds): string {
  if (template === "cloudflare") {
    return `// vite dev: the bot on workerd, with the Dev Loop (tunnel, dev Sync). vite build: dist/, for wrangler deploy.
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
${DEV_COMMENT}
  plugins: [${composureCall(dev)}, cloudflare()],
  // Bundle size is cold-start time on Workers.
  build: { minify: true },
})
`;
  }
  return `// vite dev: the bot with the Dev Loop (tunnel, dev Sync). vite build: one self-contained dist/index.js
// serving src/app.tsx. For a server of your own, write it and pass server({ entry: "src/server.ts" }).
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
${DEV_COMMENT}
  plugins: [${composureCall(dev)}, server()],
})
`;
}

function entry(template: Template, name: string): Files {
  // node and bun: the plugin builds the Default Server around src/app.tsx.
  if (template !== "cloudflare") return {};
  return {
    "src/worker.ts": `// Workers calls fetch(request, env, ctx): the App fits as is.
import { app } from "./app.tsx"

export default app
`,
    "wrangler.jsonc": json({
      $schema: "node_modules/wrangler/config-schema.json",
      name,
      main: "src/worker.ts",
      compatibility_date: "2026-10-01",
      observability: { enabled: true },
    }),
  };
}

const APP = `import { App, command, option } from "composurejs"
import { counter } from "./counter.tsx"

export const ping = command({
  name: "ping",
  description: "Check the bot is alive",
  handler: () => "Pong!",
})

export const greet = command({
  name: "greet",
  description: "Greet someone",
  options: { user: option.user("Who to greet") },
  handler: (c, { user }) => \`\${c.user.username} waves at \${user.displayName} 👋\`,
})

export const app = new App().command(ping).command(greet).command(counter)
`;

const COUNTER = `// Write the click where the button is: returned markup updates the message, and what the
// handler reads (count, owner) travels in the button's custom_id.
import { Button, command, Container, Row, Text } from "composurejs"

export const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container accentColor={0x5865f2}>
    <Text>## Count: {count}</Text>
    <Row>
      <Button style="primary" onClick={(c) => (c.user.id === owner ? <Counter count={count + 1} owner={owner} /> : c.ephemeral("Not your counter"))}>
        +1
      </Button>
      <Button onClick={(c) => (c.user.id === owner ? <Counter count={0} owner={owner} /> : c.ephemeral("Not your counter"))}>Reset</Button>
    </Row>
  </Container>
)

export const counter = command({
  name: "counter",
  description: "A counter only you can press",
  handler: (c) => <Counter count={0} owner={c.user.id} />,
})
`;

const TEST = `import { expect, test } from "vitest"
import { answer, chatInput } from "composurejs/testing"
import { app } from "../src/app.tsx"

test("the App is valid", () => {
  app.check()
})

test("/ping answers", async () => {
  expect((await answer(app, chatInput("ping"))).text).toBe("Pong!")
})

test("/greet greets the user it is given", async () => {
  expect((await answer(app, chatInput("greet").user("user", { id: "2", username: "bob", global_name: "Bob" }))).text).toBe("alice waves at Bob 👋")
})

test("/counter updates in place for its owner", async () => {
  const first = await answer(app, chatInput("counter"))
  const second = await answer(app, first.click("+1"))
  expect([second.type, second.text]).toEqual([7, "## Count: 1"])
  const stranger = await answer(app, second.click("+1").by({ id: "2" }))
  expect([stranger.text, stranger.isEphemeral]).toEqual(["Not your counter", true])
})
`;

// Vite (and, for Workers, @cloudflare/vite-plugin) loads .env.local in `vite dev`; `composure sync`
// reads .env.production.local over it (ADR 0031).
const ENV_EXAMPLE = `# Copy to .env.local for your Dev Application (read by \`pnpm dev\`) and to .env.production.local
# for production (read by \`pnpm sync\`, and \`pnpm start\` on a server), then fill each in. Never commit them.
# Developer Portal → General Information → Public Key.
DISCORD_PUBLIC_KEY=
# Developer Portal → Bot → Token. Used by c.bot, \`composure sync\` and the Dev Loop.
DISCORD_TOKEN=
# Optional, .env.local only: a named Cloudflare Tunnel's token, for dev: { tunnel: { name, hostname } }
# in vite.config.ts. Without it \`pnpm dev\` opens a quick tunnel.
# CLOUDFLARE_TUNNEL_TOKEN=
`;

function readme(template: Template, name: string): string {
  const run = template === "cloudflare" ? "pnpm build && pnpm wrangler secret put DISCORD_PUBLIC_KEY && pnpm deploy" : "pnpm build && pnpm start   # reads .env.production.local";
  return `# ${name}

A Discord bot built with [composurejs](https://github.com/BlueFrog130/composure-js) on ${TEMPLATES[template].label}.

## Develop

1. Create a separate **Dev Application** in the [Developer Portal](https://discord.com/developers/applications) and add its bot to a test server.
2. \`cp .env.example .env.local\` and fill it in with the Dev Application's public key and bot token.
3. In \`vite.config.ts\`, \`dev\` holds the Dev Application's id and your test server's (the dev guild's) id. If you skipped those questions, fill them in:

   \`\`\`ts
   composure({ dev: { application: "<id>", guild: "<id>" } })
   \`\`\`

   \`application\`: Developer Portal → General Information → Application ID. \`guild\`: turn on Developer Mode in Discord, right-click the server → Copy Server ID. They are ids, not secrets: commit them. Without \`application\`, \`pnpm dev\` prints the URL to set by hand; without \`guild\`, Commands are not synced in dev.
4. \`pnpm dev\`: serves the bot, opens a tunnel, points the Dev Application's Interactions Endpoint URL at it, and syncs Commands to the dev guild on every change.

\`pnpm test\` runs the tests; they never reach Discord.

## Deploy

\`cp .env.example .env.production.local\` and fill it in with the production application's public key and bot token${template === "cloudflare" ? " (`pnpm sync` reads it; the Worker gets its secrets from `wrangler secret put`)" : ""}.

\`\`\`sh
${run}
pnpm sync   # make Discord's global Commands match the code (asks before applying)
\`\`\`

\`pnpm build\` writes \`composure.handlers.json\`, the handler ids your buttons use: commit it. A build in CI fails when a change would make buttons already sent answer "This message is outdated.".
`;
}
