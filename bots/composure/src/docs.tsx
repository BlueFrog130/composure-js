// `/docs <topic>`: the guide's chapters and headings, indexed from docs/guide at build time (Vite
// inlines the markdown), and the main API items, suggested while typing.
import { Button, option, Section, Text, UserError } from "composurejs";
import { command, EVERYWHERE } from "./env.ts";
import * as ui from "./ui.tsx";

const GUIDE = "https://bluefrog130.github.io/composure-js/guide/";
const SOURCE = "https://github.com/BlueFrog130/composure-js/blob/main/packages/";

/** A page or section to link to. */
export interface Entry {
  /** `Handlers and Views › Code splitting` */
  title: string;
  /** Where it is, with its anchor. */
  url: string;
  /** Its first paragraph, shortened. */
  summary: string;
}

/** The items most code starts from, linked to their source (the TSDoc is the reference). */
const API: Entry[] = [
  ["command()", "composurejs/src/command.ts", "Defines a slash Command once: its Options' types, the definition Sync publishes, and its handler."],
  ["group()", "composurejs/src/command.ts", "A Command made of subcommands, and of Groups of them one level deep."],
  ["userCommand() / messageCommand()", "composurejs/src/command.ts", "Context menu Commands: right-click a user or message → Apps; the handler gets the target."],
  ["option", "composurejs/src/options.ts", "Option builders (string, integer, user, channel, ...) with .optional(), .choices() and .autocomplete()."],
  ["defineChoices()", "composurejs/src/options.ts", "A fixed set of values, shared by Options, selects and radio groups."],
  ["App", "composurejs/src/app.ts", "The explicit list of Commands and nested Apps a bot serves; app.fetch answers Discord."],
  ["createFactory()", "composurejs/src/factory.ts", "Definers bound to one Env, so c.env, c.data and c.var are typed in every module."],
  ["middleware()", "composurejs/src/middleware.ts", "Wraps every Command an App lists, and the clicks their answers render."],
  ["named()", "composurejs/src/handlers.ts", "A fixed Handler Id, for buttons that must keep working across deploys."],
  ["Context (c)", "composurejs/src/context.ts", "What every handler gets: the Interaction, env, Bot Data, c.bot, c.client, c.defer and c.ephemeral."],
  ["UserError", "composurejs/src/errors.ts", "An error whose message is shown to the user as written, ephemeral."],
  ["render()", "composurejs/src/jsx/render.ts", "Renders a View and checks it against Discord's limits, as a response would be."],
  ["composurejs/rest", "composurejs/src/rest/endpoints.ts", "Discord's REST Endpoints as functions taking a client first: createMessage(c.bot, ..)."],
  ["composurejs/testing", "composurejs/src/testing/answer.ts", "answer(app, chatInput(..)) runs the App on a signed Interaction; Discord is a MockTransport."],
  ["composure() (@composurejs/vite)", "vite/src/index.ts", "The Vite plugin: compiles Inline Handlers, runs the Dev Loop and checks placement."],
  ["server() (@composurejs/vite)", "vite/src/server-plugin.ts", "Builds the Default Server around the App, for Node and Bun."],
  ["composure sync (@composurejs/cli)", "cli/src/cli.ts", "Makes Discord's stored Commands match the App: plan, confirm, apply."],
  ["create-composurejs", "create-composurejs/src/templates.ts", "npm create composurejs: a new bot for Workers, Node or Bun, ready to test and deploy."],
].map(([title, path, summary]) => ({ title: title!, url: SOURCE + path!, summary: summary! }));

/** Every searchable entry, guide first, built on the first search. */
let index: Entry[] | undefined;
function entries(): Entry[] {
  return (index ??= [...indexGuide(import.meta.glob<string>("../../../docs/guide/*.md", { query: "?raw", import: "default", eager: true })), ...API]);
}

/** An entry per chapter (its `#` title) and per `##`-`####` heading outside code, by file name. */
export function indexGuide(files: Record<string, string>): Entry[] {
  const out: Entry[] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const page = GUIDE + path.slice(path.lastIndexOf("/") + 1, -".md".length);
    const lines = text.split(/\r?\n/);
    const chapter = plain(lines.find((line) => line.startsWith("# "))?.slice(2) ?? page);
    out.push({ title: chapter, url: page, summary: paragraphAfter(lines, 0) });
    let fenced = false;
    lines.forEach((line, i) => {
      if (line.startsWith("```")) fenced = !fenced;
      const heading = fenced ? null : /^#{2,4} (.+)$/.exec(line);
      if (heading) {
        out.push({ title: `${chapter} › ${plain(heading[1]!)}`.slice(0, 100), url: `${page}#${slug(heading[1]!)}`, summary: paragraphAfter(lines, i + 1) });
      }
    });
  }
  return out;
}

/** The first prose paragraph from line `start` on, links reduced to their text, at most ~300 characters. */
function paragraphAfter(lines: string[], start: number): string {
  const paragraph: string[] = [];
  for (const raw of lines.slice(start)) {
    const line = raw.trim();
    const blank = line === "" || line.startsWith("#") || line.startsWith(":::");
    if (blank && paragraph.length === 0) continue;
    if (blank || line.startsWith("```") || line.startsWith("|")) break;
    paragraph.push(line);
  }
  const text = stripLinks(paragraph.join(" "));
  if (text.length <= 300) return text;
  const cut = text.slice(0, 300);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : 300)}…`;
}

/** `[text](url)` → `text` */
const stripLinks = (text: string) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

/** A heading without markdown: links reduced to text, backticks dropped. */
const plain = (heading: string) => stripLinks(heading).replaceAll("`", "").trim();

/** VitePress's anchor for a heading (@mdit-vue/shared's slugify, on the heading's text). */
export function slug(heading: string): string {
  return (
    plain(heading)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // oxlint-disable-next-line no-control-regex -- removing them is the point
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^(\d)/, "_$1")
      .toLowerCase()
  );
}

/** Entries matching `query` with their index, best first: title prefix, word prefix, title, then summary matches. */
export function search(query: string): [number, Entry][] {
  const q = query.trim().toLowerCase();
  const hits: [rank: number, i: number, entry: Entry][] = [];
  entries().forEach((entry, i) => {
    const title = entry.title.toLowerCase();
    const leaf = title.split(" › ").at(-1)!;
    let rank: number;
    // An empty query lists chapters and API items, not every heading
    if (q === "") rank = entry.title.includes(" › ") ? -1 : 0;
    else if (leaf.startsWith(q) || title.startsWith(q)) rank = 0;
    else if (title.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q))) rank = 1;
    else if (title.includes(q)) rank = 2;
    else if (entry.summary.toLowerCase().includes(q)) rank = 3;
    else rank = -1;
    if (rank >= 0) hits.push([rank, i, entry]);
  });
  hits.sort((a, b) => a[0] - b[0] || a[2].title.length - b[2].title.length || a[1] - b[1]);
  return hits.map(([, i, entry]) => [i, entry]);
}

export const docs = command({
  name: "docs",
  description: "Search composurejs's guide and API",
  ...EVERYWHERE,
  options: {
    topic: option
      .string("What to look for", { maxLength: 100 })
      // The value is the entry's index
      .autocomplete((_c, input) =>
        search(input)
          .slice(0, 25)
          .map(([i, entry]) => ({ name: entry.title, value: String(i) })),
      ),
  },
  handler: (_c, { topic }) => {
    // A picked suggestion is an index; typed text is searched
    const entry = (/^\d+$/.test(topic) ? entries()[Number(topic)] : undefined) ?? search(topic)[0]?.[1];
    if (!entry) throw new UserError(`Nothing in the docs matches \`${topic}\`.`);
    return (
      <ui.Primary>
        <Section accessory={<Button url={entry.url}>Open</Button>}>
          <Text>### {entry.title}</Text>
          <Text>{entry.summary || "-# No summary."}</Text>
        </Section>
        <Text>
          -# {entry.url.startsWith(GUIDE) ? "Guide" : "Source"} · {entry.url}
        </Text>
      </ui.Primary>
    );
  },
});
