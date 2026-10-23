// What the plugin reads from the environment: Vite's env files for the mode, under the process
// environment. Settings never come from here (ADR 0031); the Dev Loop reads only these secrets.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { loadEnv } from "vite";

interface EnvConfig {
  root: string;
  mode: string;
  envDir?: string | false | undefined;
}

const envDirOf = ({ root, envDir }: EnvConfig) => (envDir === false ? root : (envDir ?? root));

/** Vite's env files for the mode (`.env.local`, ...), then the process environment over them. */
export function viteEnv(config: EnvConfig): Record<string, string | undefined> {
  return { ...loadEnv(config.mode, envDirOf(config), ""), ...process.env };
}

/** Whether `.env` sets `DISCORD_TOKEN`: Vite loads it in every mode, so a token there reaches `vite dev` (ADR 0031: no `.env`). */
export function envFileWithToken(config: EnvConfig): boolean {
  const file = join(envDirOf(config), ".env");
  return existsSync(file) && Boolean(parseEnv(readFileSync(file, "utf8")).DISCORD_TOKEN);
}

export interface Secrets {
  /** `DISCORD_TOKEN`: the Dev Application's bot token. */
  token?: string | undefined;
  /** `DISCORD_PUBLIC_KEY`: compared with the application's when Discord rejects the endpoint. */
  publicKey?: string | undefined;
  /** `CLOUDFLARE_TUNNEL_TOKEN`: a named tunnel's token, instead of `cloudflared tunnel token <name>`. */
  tunnelToken?: string | undefined;
}

export function secretsOf(env: Record<string, string | undefined>): Secrets {
  return {
    token: env.DISCORD_TOKEN || undefined,
    publicKey: env.DISCORD_PUBLIC_KEY || undefined,
    tunnelToken: env.CLOUDFLARE_TUNNEL_TOKEN || undefined,
  };
}
