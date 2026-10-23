// What the plugin reads from the environment: Vite's env files for the mode, under the process
// environment. Settings never come from here (ADR 0031); the Dev Loop reads only these secrets.
import { loadEnv } from "vite";

/** Vite's env files for the mode (`.env.local`, ...), then the process environment over them. */
export function viteEnv(config: { root: string; mode: string; envDir?: string | false | undefined }): Record<string, string | undefined> {
  const { root, mode, envDir } = config;
  return { ...loadEnv(mode, envDir === false ? root : (envDir ?? root), ""), ...process.env };
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
