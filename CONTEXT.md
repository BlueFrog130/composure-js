# composurejs

Framework for Discord bots that only receive HTTP Interactions (no gateway) and run anywhere `fetch(Request) => Response` runs: Cloudflare Workers, Bun, Deno, Node, serverless functions. A port of the ideas (not the code) of [composure-rs](https://github.com/BlueFrog130/composure-rs); where a term below matches one there, it means the same thing.

## Language

### Runtime

**Interaction**:
One inbound request from Discord (ping, command invocation, component click, autocomplete, modal submit).
_Avoid_: Event, request (when meaning the Discord payload)

**Adapter**:
The platform integration (`composurejs/cloudflare`, `/node`, `/bun`, ...) that turns a platform call into `app.fetch(request, env, platform)`: it supplies the env, a way to run Background Work, and the platform's entry point. It maps nothing itself; the pipeline is core's.
_Avoid_: Runtime, driver, server

**Platform**:
What an Adapter hands core per request beyond the env: `waitUntil` for Background Work, when the platform has one.
_Avoid_: Runtime, environment, execution context (outside the Cloudflare Adapter)

**Env**:
The platform's bindings, secrets and vars as the Adapter receives them (`env` on Workers, `process.env` on Node); reachable as `c.env`.
_Avoid_: State, config

**Credentials**:
What identifies and authorizes the Discord application: its public key (required, verifies Interactions), and optionally the bot token and application id. The only configuration composurejs itself needs; loaded at the edge, by default from the Env's `DISCORD_*` names.
_Avoid_: Config, settings

**Bot Data**:
The bot author's own typed configuration and resources, built once per isolate and reachable as `c.data` on every Adapter.
_Avoid_: App data, user data, vars (those are middleware Variables)

**Variables**:
Per-Interaction values middleware sets with `c.set` and handlers read with `c.get` / `c.var`, typed through the App's `Env` generic, as in Hono.
_Avoid_: State, locals

**Context**:
The `c` every handler and middleware receives: the Interaction, Env, Bot Data, Variables, clients, and the defer methods.
_Avoid_: Ctx (Rust name), request

**Response**:
What a handler returns to answer an Interaction: a string, a View, `Ephemeral(..)`, `Update(..)`, a Modal View, a Deferred Response, or a raw `InteractionResponse`.

**Deferred Response**:
A Response that only acknowledges the Interaction (type 5, or 6 for `deferUpdate`) and is completed later by Background Work editing the original response.
_Avoid_: Async response, delayed reply

**Background Work**:
Work run after the Interaction is answered: through the Platform's `waitUntil` when it has one (bounded by the platform, ~30s on Workers), tracked promises awaited on shutdown on Node/Bun, or the REST-callback fallback when neither exists.
_Avoid_: Task, job, spawn

**Webhook Event**:
A non-interaction notification Discord POSTs to the events path (app authorized, entitlement created, ...); ACKed with 204 at once and handled as Background Work.
_Avoid_: Gateway event, Interaction

**Error Renderer**:
The one output composurejs renders itself: what the user sees when a handler throws, both for the initial response and for failed Background Work. Set with `app.onError`, at most one per App tree.
_Avoid_: Error handler (it renders, it does not recover), Theme

**User Error**:
An error thrown with `new UserError(msg)`, whose message is meant for the user and shown as written (ephemeral). Any other throw is logged and shown as a generic message.

### Discord types

**Wire Types**:
TypeScript types of Discord's JSON, taken from `discord-api-types` (types only) for Interactions and components, and generated from the vendored OpenAPI spec for REST.
_Avoid_: Models, DTOs

**Snowflake**:
Discord's 64-bit time-ordered id, carried as a string.

### REST

**Transport**:
The injectable way to send one HTTP request (default `fetch`); the REST clients' only contact with the network. Tests inject a `MockTransport`.
_Avoid_: HTTP client, connector

**Interaction Client**:
REST client authorized by an Interaction's token (follow-ups, editing the original response); needs no bot token; `c.client`.

**Bot Client**:
REST client authorized by the bot token; `c.bot`, available only when the Credentials include one. "bot" always means this, never the App.
_Avoid_: HTTP client, API client

**Endpoint**:
One Discord REST route (method + path) exposed as a client method.
_Avoid_: Route (that is what an App lists)

### Commands

**App**:
The explicit list of Routes a bot serves, built by chaining (`new App().command(..).route(..)`); the single source both for dispatching Interactions and for Sync. Apps nest, so a module can list its own and the root routes to it.
_Avoid_: Router, registry, command set, bot (that is the Bot Client)

**Route**:
Anything an App lists: Command, Group, Component Handler, Modal Handler, View, or another App. It answers the Interactions addressed to it, by command name and type or by `custom_id` prefix.
_Avoid_: Handler (alone), endpoint

**Middleware**:
A function `(c, next)` wrapped around every Route its App lists (onion order, nested Apps' inside), seeing every Interaction kind but Ping; it short-circuits by returning a Response instead of calling `next`.
_Avoid_: Hook, guard (a guard is one use of it)

**Command**:
A user-invokable application command defined once in code (`command({..})`, `userCommand`, `messageCommand`), from which both its handler's argument types and its Command Definition derive.
_Avoid_: Slash command (too narrow; user/message commands are Commands too)

**Context Menu Command**:
A user or message Command (`userCommand`, `messageCommand`) invoked from right-click → Apps; its handler receives the resolved target.
_Avoid_: Context command, app command

**Command Definition**:
The description of a Command that Discord stores (name, description, Options, permissions, contexts).
_Avoid_: Command schema, registration

**Option**:
A typed input a user supplies when invoking a Command; arrives in the handler resolved (a `user` Option is a User).
_Avoid_: Argument, parameter (when meaning the Discord-side input)

**Choice**:
One of a fixed set of values an Option, or a modal field, is restricted to; defined once with `defineChoices` and shared by both.

**Group**:
A Command that only contains subcommands (or nested Groups) and cannot be invoked itself.
_Avoid_: Parent command, category

**Autocomplete Handler**:
Code suggesting Choices for one Option while the user types; declared inline on the Option.

**Scope**:
A named deployment destination for a top-level Command (`scope: "dev"`), resolved to concrete guilds at Sync time; Commands without a Scope are global.
_Avoid_: Guild (when meaning the named destination), environment

### Components and Views

**View**:
A reusable piece of message or modal layout, defined as a pure function of its Props and written in JSX; the components it renders and the handlers for their events derive from it. Re-rendering means answering an Interaction with the View rendered from new Props. A View is the whole message: components, `ephemeral`, allowed mentions, files.
_Avoid_: Template, widget, component (that word is Discord's)

**Props**:
The inputs a View renders from, declared with a codec (`p.*`). Inline handlers see only the Props and keys they capture.
_Avoid_: Signal, store, state

**Inline Handler**:
A closure in a View's markup (`onClick={on("like", () => ..)}`), named, and hoisted out of render by the Vite plugin, which encodes only the Props and keys it captures into its `custom_id`.
_Avoid_: Callback, listener

**Component Handler**:
Code defined outside any View (`component("vote", {..})`) answering clicks and selections on components whose `custom_id` starts with its prefix, with typed Custom ID State.
_Avoid_: Button handler, listener

**Modal Handler**:
Code answering a modal submit routed by `custom_id` prefix, receiving the submitted fields typed by a field schema (`f.*`).

**Custom ID State**:
Values carried in a `custom_id` after its prefix and handler name instead of stored anywhere: `prefix:field:field` with `\` escapes, at most 100 characters.
_Avoid_: Session, payload

**Codec**:
The compact, built-in description of how a value is written to and read from Custom ID State (`p.string()`, `p.int()`, `p.snowflake()`, ...).
_Avoid_: Schema (that is a field schema or Standard Schema), serializer

**Fallback**:
What answers a component or modal submit whose prefix or handler name is unknown, or whose state does not decode: "this message is outdated", never a crash.

**Limits**:
Discord's constraints on a message (40 components, 4000 characters of text, 5 buttons per row, 100-character `custom_id`, placement rules, ...), checked by the one validation walk at render so a violation throws an error naming it instead of Discord answering "This interaction failed".

### Deployment

**Sync**:
Making Discord's stored Command Definitions match the ones in code, deleting any Discord has that code does not.
_Avoid_: Migration, register, publish, deploy

**Sync Plan**:
The creates, updates, and deletes a Sync would perform, shown before it is applied.
_Avoid_: Diff, migration

**Dev Loop**:
What `vite dev` with `@composurejs/vite` runs: the App served through Vite, a tunnel, the dev application's interactions endpoint pointed at it, and Sync to a dev guild on change.
