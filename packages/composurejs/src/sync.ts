// Sync: make Discord's stored Command Definitions match an App's, at deploy time (composure-rs's
// composure_sync). Each target (global, or one guild) gets every Command whose Scope maps to it;
// targets with changes are overwritten with one bulk request each, the others are left alone.
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10";
import type { ScopedDefinition } from "./app.ts";
import { APPLICATION_ID_VAR, TOKEN_VAR } from "./credentials.ts";
import { BotClient, type RestOptions } from "./rest/client.ts";
import { bulkOverwriteGlobalCommands, bulkOverwriteGuildCommands, getGlobalCommands, getGuildCommands } from "./rest/endpoints.ts";

export type Definition = RESTPostAPIApplicationCommandsJSONBody;

export { APPLICATION_ID_VAR, TOKEN_VAR };
export const SCOPE_VAR_PREFIX = "COMPOSURE_SCOPE_";

export interface SyncConfig {
  token: string;
  applicationId: string;
  /** Guild ids by Scope key (`dev` → `COMPOSURE_SCOPE_DEV`). */
  scopes: Record<string, string[]>;
  /** Send every Command to this one guild instead (`--guild`): a quick test of the whole bot. */
  guild?: string | undefined;
}

export class SyncError extends Error {
  override name = "SyncError";
}

const SNOWFLAKE = /^\d{17,20}$/;

/** `COMPOSURE_SCOPE_<NAME>`: the env var holding a Scope's guild ids. */
export const scopeKey = (scope: string) => scope.toUpperCase().replace(/-/g, "_");

/**
 * Reads `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` (default: the id a bot token starts with) and
 * `COMPOSURE_SCOPE_<NAME>=<guild id>[,<guild id>]`.
 */
export function configFromEnv(env: Record<string, string | undefined>): SyncConfig {
  const token = env[TOKEN_VAR];
  if (!token) throw new SyncError(`${TOKEN_VAR} is not set`);
  const applicationId = env[APPLICATION_ID_VAR] || idFromToken(token);
  if (!applicationId) throw new SyncError(`${APPLICATION_ID_VAR} is not set, and the token does not start with the application id`);
  const scopes: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(SCOPE_VAR_PREFIX) || !value) continue;
    const guilds = value
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    for (const guild of guilds) if (!SNOWFLAKE.test(guild)) throw new SyncError(`${name}: "${guild}" is not a guild id`);
    scopes[name.slice(SCOPE_VAR_PREFIX.length)] = guilds;
  }
  return { token, applicationId, scopes };
}

/** A bot token's first segment is its user id (base64), which is the application id. */
function idFromToken(token: string): string | undefined {
  try {
    const id = atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"));
    return SNOWFLAKE.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export interface Target {
  /** Undefined for global. */
  guildId: string | undefined;
  label: string;
  commands: Definition[];
}

const GLOBAL_ONLY = ["contexts", "integration_types", "dm_permission"] as const;

/** Guild Commands cannot carry the global-only install settings. */
function forGuild(definition: Definition): Definition {
  const copy: Record<string, unknown> = { ...definition };
  for (const key of GLOBAL_ONLY) delete copy[key];
  return copy as unknown as Definition;
}

const keyOf = (d: Definition) => `${d.type ?? 1}:${d.name}`;

export function label(d: Pick<Definition, "name" | "type">): string {
  return d.type === 2 ? `${d.name} (user)` : d.type === 3 ? `${d.name} (message)` : `/${d.name}`;
}

/**
 * Where each Command goes. Global plus every guild listed for any Scope, so a guild whose Commands
 * were all removed is cleared; guilds no Scope lists are never touched.
 */
export function targets(definitions: readonly ScopedDefinition[], config: SyncConfig): Target[] {
  const out = new Map<string, Target>();
  const target = (guildId: string | undefined, scope?: string) => {
    const key = guildId ?? "global";
    let t = out.get(key);
    if (!t) out.set(key, (t = { guildId, label: guildId ? `guild ${guildId}${scope ? ` (${scope})` : ""}` : "global", commands: [] }));
    return t;
  };

  if (config.guild) {
    const t = target(config.guild);
    for (const { definition } of definitions) t.commands.push(forGuild(definition));
  } else {
    target(undefined);
    for (const [scope, guilds] of Object.entries(config.scopes)) for (const g of guilds) target(g, scope.toLowerCase());
    for (const { scope, definition } of definitions) {
      if (scope === undefined) {
        target(undefined).commands.push(definition);
        continue;
      }
      const guilds = config.scopes[scopeKey(scope)];
      if (!guilds?.length) throw new SyncError(`${label(definition)} has scope "${scope}", but ${SCOPE_VAR_PREFIX}${scopeKey(scope)} lists no guilds`);
      for (const g of guilds) target(g, scope).commands.push(forGuild(definition));
    }
  }

  for (const t of out.values()) {
    const seen = new Set<string>();
    for (const d of t.commands) {
      if (seen.has(keyOf(d))) throw new SyncError(`${label(d)} would be sent twice to ${t.label}`);
      seen.add(keyOf(d));
    }
  }
  return [...out.values()];
}

export type ChangeKind = "create" | "update" | "delete";
export interface Change {
  kind: ChangeKind;
  label: string;
}

export interface TargetPlan extends Target {
  changes: Change[];
  unchanged: number;
}

export interface SyncPlan {
  targets: TargetPlan[];
}

export const hasChanges = (plan: SyncPlan) => plan.targets.some((t) => t.changes.length > 0);

export function counts(plan: SyncPlan): Record<ChangeKind, number> {
  const out = { create: 0, update: 0, delete: 0 };
  for (const t of plan.targets) for (const c of t.changes) out[c.kind]++;
  return out;
}

/** Compares each target's Commands with what Discord stores, by name and type. */
export function planTarget(target: Target, current: readonly Definition[]): TargetPlan {
  const existing = new Map(current.map((d) => [keyOf(d), d]));
  const changes: Change[] = [];
  let unchanged = 0;
  for (const d of target.commands) {
    const now = existing.get(keyOf(d));
    existing.delete(keyOf(d));
    if (!now) changes.push({ kind: "create", label: label(d) });
    else if (!same(d, now)) changes.push({ kind: "update", label: label(d) });
    else unchanged++;
  }
  for (const d of existing.values()) changes.push({ kind: "delete", label: label(d) });
  return { ...target, changes, unchanged };
}

/**
 * Equal once Discord's filled-in defaults are ignored. `contexts` and `integration_types` are only
 * compared when the Definition sets them, since Discord defaults them from app settings.
 */
export function same(desired: Definition, current: Definition): boolean {
  const want = normalize(desired) as Record<string, unknown>;
  const have = normalize(current) as Record<string, unknown>;
  for (const key of ["contexts", "integration_types"]) if (!(key in want)) delete have[key];
  for (const key of ["id", "application_id", "version", "guild_id", "default_permission"]) delete have[key];
  return JSON.stringify(sortKeys(want)) === JSON.stringify(sortKeys(have));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) if (!isDefault(key, v)) out[key] = normalize(v);
  return out;
}

function isDefault(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if ((key === "required" || key === "nsfw" || key === "autocomplete") && value === false) return true;
  if (key === "dm_permission" && value === true) return true;
  if (key === "description" && value === "") return true;
  if ((key === "options" || key === "choices" || key === "channel_types") && Array.isArray(value) && value.length === 0) return true;
  if ((key === "name_localizations" || key === "description_localizations") && typeof value === "object" && Object.keys(value).length === 0) return true;
  return key === "type" && value === 1;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  );
}

/** Sync waits out rate limits of up to a minute; it runs at deploy time, not in a request. */
const syncRest = (config: SyncConfig, rest: RestOptions) => new BotClient(config.token, { maxRateLimitWait: 60_000, ...rest });

/** Fetches what Discord stores for every target and compares. */
export async function plan(definitions: readonly ScopedDefinition[], config: SyncConfig, rest: RestOptions = {}): Promise<SyncPlan> {
  const client = syncRest(config, rest);
  const planned = await Promise.all(
    targets(definitions, config).map(async (t) => {
      const query = { with_localizations: true };
      const current = t.guildId ? await getGuildCommands(client, config.applicationId, t.guildId, query) : await getGlobalCommands(client, config.applicationId, query);
      return planTarget(t, (current ?? []) as Definition[]);
    }),
  );
  return { targets: planned };
}

/** Overwrites each target with changes, in one bulk request each. */
export async function apply(plan: SyncPlan, config: SyncConfig, rest: RestOptions = {}): Promise<void> {
  const client = syncRest(config, rest);
  for (const t of plan.targets) {
    if (t.changes.length === 0) continue;
    const body = t.commands as never;
    if (t.guildId) await bulkOverwriteGuildCommands(client, config.applicationId, t.guildId, body);
    else await bulkOverwriteGlobalCommands(client, config.applicationId, body);
  }
}

/** How a plan is drawn: plain by default; the CLI colors it. */
export type PlanStyle = (part: ChangeKind | "target" | "dim", text: string) => string;
const plain: PlanStyle = (_, text) => text;

/** One line for the totals: "2 to create, 1 to update, 1 to delete". */
export function summary(plan: SyncPlan): string {
  const n = counts(plan);
  return hasChanges(plan) ? `${n.create} to create, ${n.update} to update, ${n.delete} to delete` : "Discord is up to date";
}

/** The plan as text: one line per change, grouped by target, then the totals. */
export function formatPlan(plan: SyncPlan, style: PlanStyle = plain): string {
  const sign = { create: "+", update: "~", delete: "-" };
  const lines: string[] = [];
  for (const t of plan.targets) {
    const tail = t.unchanged > 0 ? style("dim", ` (${t.unchanged} unchanged)`) : "";
    if (t.changes.length === 0) {
      lines.push(`${style("target", t.label)}: ${style("dim", "up to date")}${tail}`);
      continue;
    }
    lines.push(`${style("target", t.label)}:${tail}`);
    for (const c of t.changes) lines.push(`  ${style(c.kind, `${sign[c.kind]} ${c.label}`)}`);
  }
  lines.push(summary(plan));
  return lines.join("\n");
}
