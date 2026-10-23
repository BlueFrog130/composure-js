# composurejs

Framework for Discord bots that only receive HTTP Interactions (no gateway) and run anywhere `fetch(Request) => Response` runs: Cloudflare Workers, Bun, Deno, Node, serverless functions. A port of the ideas (not the code) of [composure-rs](https://github.com/BlueFrog130/composure-rs); where a term below matches one there, it means the same thing.

## Language

### Runtime

**Interaction**:
One inbound request from Discord (ping, command invocation, component click, autocomplete, modal submit).
_Avoid_: Event, request (when meaning the Discord payload)

**Entry**:
The module a platform runs, which turns its call into `app.fetch(request, env, platform)`: it supplies the env, a way to run Background Work, and the export the platform expects. On Workers it is `export default app`; on Node and Bun it is the Default Server unless `server({ entry })` names your own. It maps nothing itself; the pipeline is core's.
_Avoid_: Adapter (there are no adapter packages; ADR 0024), driver

**Default Server**:
The `node:http` server that `server()` from `@composurejs/vite` builds around the App for Node and Bun (`serve` from `@composurejs/vite/server`): `PORT`, `process.env` as the env, tracked Background Work, graceful shutdown, `GET /health`.
_Avoid_: Adapter, Node Adapter

**Platform**:
What the Entry hands core per request beyond the env: `waitUntil` for Background Work, when the platform has one.
_Avoid_: Runtime, environment, execution context (outside Workers)

**Env**:
The platform's bindings, secrets and vars as the Entry receives them (`env` on Workers, `process.env` on Node); reachable as `c.env`.
_Avoid_: State, config

**Credentials**:
What identifies and authorizes the Discord application: its public key (required, verifies Interactions), and optionally the bot token and application id. The only configuration composurejs itself needs; loaded at the edge, by default from the Env's `DISCORD_*` names.
_Avoid_: Config, settings

**Bot Data**:
The bot author's own typed configuration and resources, built once per isolate and reachable as `c.data` on every platform.
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

**Auto Defer**:
The Deferred Response composurejs sends by itself when a handler has not answered in time, so a slow handler still beats Discord's 3 seconds; the handler's eventual answer is edited in.
_Avoid_: Timeout, auto-ack

**Background Work**:
Work run after the Interaction is answered: through the Platform's `waitUntil` when it has one (bounded by the platform, ~30s on Workers), tracked promises awaited on shutdown on Node/Bun, or the REST-callback fallback when neither exists.
_Avoid_: Task, job, spawn

**Webhook Event**:
A non-interaction notification Discord POSTs to the events path (app authorized, entitlement created, ...); ACKed with 204 at once and handled as Background Work.
_Avoid_: Gateway event, Interaction

**Event Handler**:
The one function (`app.events((c, event) => ..)`, at most one per App tree) answering Webhook Events; `event` is a union decoded from Discord's event types, `{ type: "unknown", raw }` for anything else.
_Avoid_: Listener, subscriber

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
One Discord REST route (method + path, as in the OpenAPI spec), exposed as a function in `composurejs/rest` taking the client first (`createMessage(c.bot, ..)`), or as an Interaction Client method.
_Avoid_: Route (that is what an App lists)

### Commands

**App**:
The explicit list of Routes a bot serves, built by chaining (`new App().command(..).route(..)`); the single source both for dispatching Interactions and for Sync. Apps nest, so a module can list its own and the root routes to it.
_Avoid_: Router, registry, command set, bot (that is the Bot Client)

**Route**:
Anything an App lists: a Command, a Group, or another App. It answers the Interactions addressed to it by command name and type; clicks and modal submits route to Inline Handlers instead, which are not listed.
_Avoid_: Handler (alone), endpoint

**Middleware**:
A function `(c, next)` wrapped around every Route its App lists (onion order, nested Apps' inside), seeing every Interaction kind but Ping; it short-circuits by returning a Response instead of calling `next`.
_Avoid_: Hook, guard (a guard is one use of it)

**Owning Route**:
The Command whose answer first rendered an Inline Handler. A click runs the Owning Route's Middleware, and handlers rendered by that click keep the same Owning Route. Messages sent outside any Command have none and run the root App's Middleware.
_Avoid_: Parent command, origin

**Localizations**:
Translations of a Command Definition's names, descriptions and Choice names, per Discord locale, published with it by Sync. Not the text of Responses.
_Avoid_: i18n, translations (alone)

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
One of a fixed set of values an Option, select or radio group is restricted to; defined once with `defineChoices` and shared.

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
Markup a handler returns: built-in tags and plain function components (`const Counter = ({ count }) => <Row>..</Row>`), with no declaration or registration. Re-rendering means answering a click with the View rendered from new props. A View is the whole message: components, `ephemeral`, allowed mentions, files.
_Avoid_: Template, widget, component (alone: that word is Discord's)

**Inline Handler**:
A function written as `onClick` / `onSelect` / `onSubmit` anywhere in markup. `@composurejs/vite` hoists it to module scope under a stable id, and what it reads from the functions around it (props, locals, loop variables, a command handler's `c`) travels in its `custom_id` (ADR 0015).
_Avoid_: Callback, listener, Component Handler

**Capture**:
A value an Inline Handler reads from an enclosing function, carried in its `custom_id` as a self-describing field (`i` snowflake, `n` integer, `s` string, ...); objects and functions cannot be captured.
_Avoid_: State (alone), props (a capture may be any local)

**Handler Id**:
The routing part of a `custom_id`: generated (`_` and a hash of file, owner, position and captures) or chosen with `named("id", fn)` for messages meant to last.
_Avoid_: Prefix, key

**Handler Lock**:
The committed list of every Handler Id a bot's code ships, with what each captures, so a change that would turn messages already sent into the Fallback is seen in review and stopped in CI.
_Avoid_: Manifest, snapshot

**Form**:
A typed definition of a modal's inputs, from which the modal is rendered and its submitted values are typed and parsed.
_Avoid_: Schema, modal (the Form is what a modal shows)

**Field**:
One input of a Form: its kind, label, whether it is required, and how its submitted value is parsed.
_Avoid_: Input (that is the rendered component), control

**Custom ID State**:
A Handler Id followed by its Captures: `id:field:field`, `:` separated with `\` escapes, at most 100 characters.
_Avoid_: Session, payload

**Fallback**:
What answers a component or modal submit whose Handler Id is unknown or whose Captures do not decode: "This message is outdated.", never a crash.

**Upload**:
A file sent with a message, created with `upload(name, data)` and placed as a `src`; render attaches it and refers to it as `attachment://<name>`.
_Avoid_: Attachment (that is a file Discord already has), file (alone)

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
What `vite dev` with `@composurejs/vite` runs: the App served through Vite, a tunnel, the Dev Application's interactions endpoint pointed at it, and Sync to a dev guild on change.

**Dev Application**:
The Discord application a project names as its development one: the only application whose interactions endpoint the Dev Loop ever changes, and only when the bot token belongs to it. Never the production application.
_Avoid_: Test bot, dev bot, staging app

**Tunnel**:
The public HTTPS URL forwarding to `vite dev` that the Dev Loop points the Dev Application at. A quick tunnel (a random `trycloudflare.com` host, the default), a named tunnel (a Cloudflare Tunnel on the developer's own hostname), or one the developer already runs.
_Avoid_: Proxy, forwarder
