import { CredentialsError } from "./errors.ts";

/** What identifies and authorizes the Discord application (ADR 0008). */
export interface Credentials {
  /** Hex Ed25519 public key from the Developer Portal; verifies Interactions. */
  publicKey: string;
  /** Bot token; enables `c.bot`. */
  token?: string | undefined;
  applicationId?: string | undefined;
}

export const PUBLIC_KEY_VAR = "DISCORD_PUBLIC_KEY";
export const TOKEN_VAR = "DISCORD_TOKEN";
export const APPLICATION_ID_VAR = "DISCORD_APPLICATION_ID";

/** Reads Credentials from the conventional `DISCORD_*` names of an Env record (`env` on Workers, `process.env` on Node and Bun). */
export function credentialsFromEnv(env: unknown): Credentials {
  const lookup = (name: string): string | undefined => {
    const value = env && typeof env === "object" ? (env as Record<string, unknown>)[name] : undefined;
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const publicKey = lookup(PUBLIC_KEY_VAR);
  if (!publicKey) throw new CredentialsError(`${PUBLIC_KEY_VAR} is not set`);
  return { publicKey, token: lookup(TOKEN_VAR), applicationId: lookup(APPLICATION_ID_VAR) };
}
