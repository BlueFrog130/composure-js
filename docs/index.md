---
layout: home
hero:
  name: composurejs
  text: Discord bots over HTTP, on any fetch runtime
  tagline: Commands typed from their definitions, JSX for messages, handlers written where the button is. Cloudflare Workers, Node and Bun, built with Vite.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why it's built this way
      link: /adr/0001-explicit-registration
features:
  - title: Handlers where the button is
    details: "onClick={(c) => <Counter count={count + 1} />}: the Vite plugin hoists the handler, carries what it reads in the button's custom_id, and the markup it returns updates the message."
  - title: Typed from one definition
    details: A Command's options type its handler's arguments; one list of Commands drives both dispatch and Sync.
  - title: Checked before Discord sees it
    details: Every message is validated against Discord's limits at render, with errors that name the rule, instead of "This interaction failed".
  - title: One command to develop
    details: vite dev serves the bot, opens a tunnel, points your dev application at it and syncs Commands to a dev guild on every save.
---
