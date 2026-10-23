/** An error whose message is meant for the user: shown as written, ephemeral, and not logged as a failure. */
export class UserError extends Error {
  override name = "UserError";
}

/** An Interaction addressed to a Command no App in the tree lists (e.g. removed but not yet synced). */
export class UnknownCommandError extends Error {
  override name = "UnknownCommandError";
  constructor(readonly command: string) {
    super(`No Command "${command}" is listed in this App`);
  }
}

/** The Interaction's Options do not match the Command's definition (usually: changed but not yet synced). */
export class InvalidOptionsError extends Error {
  override name = "InvalidOptionsError";
}

/** The App tree breaks a rule checked when it is built (ADR 0001). */
export class AppConfigError extends Error {
  override name = "AppConfigError";
}

/** Credentials are missing or malformed. */
export class CredentialsError extends Error {
  override name = "CredentialsError";
}

/** Markup breaks a placement rule or one of Discord's Limits (ADR 0004); names the rule. */
export class RenderError extends Error {
  override name = "RenderError";
}

/** Discord answered a REST request with an error. `route` is the template, never the URL (it can hold a token). */
export class DiscordApiError extends Error {
  override name = "DiscordApiError";
  constructor(
    readonly status: number,
    /** Discord's JSON error code (10008 Unknown Message, 50013 Missing Permissions, ...), if any. */
    readonly code: number | undefined,
    readonly route: string,
    /** Per-field validation errors, as Discord sends them. */
    readonly errors: unknown,
    message: string,
  ) {
    super([`${route}: ${status}${code !== undefined ? ` (${code})` : ""} ${message}`, ...fieldErrors(errors)].join("\n  "));
  }
}

/** Discord's nested per-field errors as `path: message (CODE)` lines: `components[0].label: This field is required (BASE_TYPE_REQUIRED)`. */
function fieldErrors(errors: unknown, path = ""): string[] {
  if (typeof errors !== "object" || errors === null) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (key === "_errors" && Array.isArray(value)) {
      for (const e of value as { code?: unknown; message?: unknown }[]) out.push(`${path || "body"}: ${String(e.message)} (${String(e.code)})`);
    } else out.push(...fieldErrors(value, /^\d+$/.test(key) ? `${path}[${key}]` : path ? `${path}.${key}` : key));
  }
  return out;
}

/** Discord did not answer a REST request within the client's timeout (ADR 0006). `route` is the template. */
export class RequestTimeoutError extends Error {
  override name = "RequestTimeoutError";
  constructor(
    readonly route: string,
    /** The timeout, in ms. */
    readonly timeout: number,
  ) {
    super(`${route}: no response within ${timeout}ms`);
  }
}

/** A 429, or a used-up rate limit bucket, asked to wait longer than the client's cap (ADR 0006). */
export class RateLimitedError extends Error {
  override name = "RateLimitedError";
  constructor(
    readonly route: string,
    /** Seconds Discord asked to wait. */
    readonly retryAfter: number,
    readonly global: boolean,
  ) {
    super(`${route}: rate limited for ${retryAfter}s${global ? " (global)" : ""}`);
  }
}

/** A handler returned something that cannot answer an Interaction. */
export class ResponseError extends Error {
  override name = "ResponseError";
}
