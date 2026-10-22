# Troubleshooting

**Discord says "This interaction failed".** Your bot answered with something Discord rejected, didn't answer within 3 seconds, or wasn't reached at all. Check the log: render errors (limits, placement) and handler errors are logged with what went wrong. For slow work, [defer](./deferring).

**The Interactions Endpoint URL won't save.** Discord sends a signed PING to a new URL first. The server must be running and reachable, and `DISCORD_PUBLIC_KEY` must be the public key of that same application. A wrong key gets 401.

**Commands don't show up.** Run `composure sync` (or set `COMPOSURE_DEV_GUILD` while developing). Global Commands can take a while to appear in clients; guild Commands appear at once. Check `contexts` and `integrationTypes` if a Command is missing in DMs or in user installs.

**"This message is outdated."** The button's handler id no longer exists, or its values no longer decode. Usually the handler moved, was renamed, or now captures something different. Use [`named()`](./views#ids-deploys-and-named) for messages meant to last.

**`<Button onClick> got a function the build did not compile`.** Either the build didn't run the plugin (add `composure()` to `plugins` in `vite.config.ts`, and to `vitest.config.ts` for tests), or the function reached the prop some way the plugin cannot follow, such as stored in an object or returned from a component. Write handlers inline, at module scope or with `named()`, and pass handler props on unchanged ([Where a handler can come from](./views#where-a-handler-can-come-from)).

**`onClick={go}: go is a local variable`** or **`a handler made by a call cannot be hoisted`.** Write the function inline on the prop.

**`The handler in .. captures \`user\`, which is an object`.** Handlers carry their values in the button's `custom_id`. Capture `user.id` and load the rest inside the handler.

**`custom_id is 112 characters; the limit is 100`.** The captured values are too long. Capture an id and load the data in an async component or the handler.

**`<Local> is defined inside a function, but the onClick handler rendering it is hoisted to module scope`.** Move the component to module scope.

**`'File' cannot be used as a JSX component`** (or `Text`, `Option`). The tag is missing from your imports, so TypeScript found the DOM global of the same name. Import it from `composurejs`.

**`c.bot needs a bot token`.** Set `DISCORD_TOKEN`, or pass `credentials: { publicKey, token }` to the App.

**Rate limited.** Short waits are handled. `RateLimitedError` means Discord asked for longer than 2 seconds: slow down, or do the work in deferred or background work.

**Something else?** The [decisions](/adr/0001-explicit-registration) explain why each part works the way it does. Issues are welcome on [GitHub](https://github.com/BlueFrog130/composure-js/issues).
