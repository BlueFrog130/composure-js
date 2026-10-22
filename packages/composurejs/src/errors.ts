/** An error whose message is meant for the user: shown as written, ephemeral, and not logged as a failure. */
export class UserError extends Error {
  override name = "UserError"
}

/** An Interaction addressed to a Command no App in the tree lists (e.g. removed but not yet synced). */
export class UnknownCommandError extends Error {
  override name = "UnknownCommandError"
  constructor(readonly command: string) {
    super(`No Command "${command}" is listed in this App`)
  }
}

/** The Interaction's Options do not match the Command's definition (usually: changed but not yet synced). */
export class InvalidOptionsError extends Error {
  override name = "InvalidOptionsError"
}

/** The App tree breaks a rule checked when it is built (ADR 0001). */
export class AppConfigError extends Error {
  override name = "AppConfigError"
}

/** Credentials are missing or malformed. */
export class CredentialsError extends Error {
  override name = "CredentialsError"
}

/** Markup breaks a placement rule or one of Discord's Limits (ADR 0004); names the rule. */
export class RenderError extends Error {
  override name = "RenderError"
}

/** A handler returned something that cannot answer an Interaction. */
export class ResponseError extends Error {
  override name = "ResponseError"
}
