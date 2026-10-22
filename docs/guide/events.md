# Webhook Events

Discord sends some notifications by HTTP rather than as Interactions: an app was authorized, an entitlement was created. Set the app's **Event Webhooks URL** to your bot's `/events`, and handle them with one function:

```tsx twoslash
import { App } from "composurejs"
import { createDM, createMessage } from "composurejs/rest"
// ---cut---
export const app = new App().events(async (c, event) => {
  switch (event.type) {
    case "APPLICATION_AUTHORIZED": {
      const dm = await createDM(c.bot, event.data.user.id)
      //                                     ^?
      await createMessage(c.bot, dm.id, "Thanks for adding me!")
      break
    }
    case "ENTITLEMENT_CREATE":
      console.info({ msg: "New entitlement", sku: event.data.sku_id })
      break
    case "unknown":
      // An event this version does not know, as Discord sent it.
      break
  }
})
```

`event` is a union: `switch (event.type)` narrows `event.data`. Unknown or malformed events arrive as `{ type: "unknown", raw }` and never throw. Repeated failures make Discord disable the events URL, so nothing about an event can break it.

Each event is acknowledged with 204 right away and handled as Background Work. Errors are logged, not retried. The handler's `c` has `env`, `data`, `bot` and `waitUntil`. The path is `/events` unless you set `new App({ eventsPath })`. A bot has one events URL, so at most one App in a tree sets `events`.
