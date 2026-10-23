// `/package [name]`: a composurejs package's npm stats, fetched as Background Work after a Deferred
// Response and cached for 10 minutes. composure-rs's bot has `/crate` for its crates.
import { Button, defineChoices, option, Row, Separator, Text } from "composurejs";
import { command, type Data, EVERYWHERE } from "./env.ts";
import { getJson } from "./http.ts";
import * as ui from "./ui.tsx";

const CACHE_TTL = 10 * 60;

/** The published packages, by name: their folder under packages/. */
const FOLDERS = {
  composurejs: "composurejs",
  "@composurejs/vite": "vite",
  "@composurejs/cli": "cli",
  "@composurejs/eslint-plugin": "eslint-plugin",
  "create-composurejs": "create-composurejs",
} as const;

export type PackageName = keyof typeof FOLDERS;

const Packages = defineChoices(Object.fromEntries(Object.keys(FOLDERS).map((name) => [name, name])) as Record<PackageName, string>);

/** The stats shown, as cached. */
export interface Stats {
  name: PackageName;
  description: string | undefined;
  version: string;
  /** `2026-10-20` */
  published: string | undefined;
  lastMonth: number;
  lastWeek: number;
}

interface Packument {
  description?: string;
  "dist-tags": { latest: string };
  time?: Record<string, string>;
}

/** Stats for `name`, from the cache or npm. */
export async function stats({ store, http }: Data, name: PackageName): Promise<Stats> {
  const key = `package:${name}`;
  const cached = await store.get(key);
  if (cached !== null) return JSON.parse(cached) as Stats;
  const downloads = (period: string) => getJson<{ downloads: number }>(http, `https://api.npmjs.org/downloads/point/${period}/${name}`).then((d) => d.downloads);
  const [packument, lastMonth, lastWeek] = await Promise.all([
    getJson<Packument>(http, `https://registry.npmjs.org/${name.replace("/", "%2F")}`),
    downloads("last-month"),
    downloads("last-week"),
  ]);
  const version = packument["dist-tags"].latest;
  const result: Stats = { name, description: packument.description, version, published: packument.time?.[version]?.slice(0, 10), lastMonth, lastWeek };
  await store.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL });
  return result;
}

/** The stats as a card. */
export const Card = ({ stats }: { stats: Stats }) => (
  <ui.Primary>
    <Text>
      ## {stats.name} {stats.version}
    </Text>
    {stats.description && <Text>{stats.description}</Text>}
    <Separator />
    <Text>
      **{stats.lastMonth.toLocaleString("en-US")}** downloads in the last month · **{stats.lastWeek.toLocaleString("en-US")}** in the last week
      {stats.published && `\n-# Published ${stats.published}`}
    </Text>
    <Row>
      <Button url={`https://www.npmjs.com/package/${stats.name}`}>npm</Button>
      <Button url={`https://github.com/BlueFrog130/composure-js/tree/main/packages/${FOLDERS[stats.name]}`}>Source</Button>
      <Button url="https://bluefrog130.github.io/composure-js/">Guide</Button>
    </Row>
  </ui.Primary>
);

export const pkg = command({
  name: "package",
  description: "Show a composurejs package's version and downloads",
  ...EVERYWHERE,
  options: { name: option.string("Which package (default: composurejs)").choices(Packages).optional() },
  // npm may take a while; the Deferred Response buys up to 15 minutes (about 30s of Background Work on Workers)
  handler: (c, { name = "composurejs" }) => c.defer(async () => <Card stats={await stats(c.data, name)} />),
});
