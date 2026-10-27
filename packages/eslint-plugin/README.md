# <img src="https://raw.githubusercontent.com/BlueFrog130/composure-js/main/assets/logo.svg" width="32" height="32" alt="" align="top"> @composurejs/eslint-plugin

[![npm](https://img.shields.io/npm/v/@composurejs/eslint-plugin?color=5865f2)](https://www.npmjs.com/package/@composurejs/eslint-plugin)
[![Guide](https://img.shields.io/badge/docs-guide-5865f2)](https://bluefrog130.github.io/composure-js/)
[![License](https://img.shields.io/npm/l/@composurejs/eslint-plugin?color=blue)](https://github.com/BlueFrog130/composure-js/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5865f2?logo=discord&logoColor=white)](https://discord.com/invite/8rWjWtp3pG)

Discord only accepts some components inside others: a `Button` goes in a `Row` or a `Section`'s `accessory`, a `TextInput` in a `Label` inside a `Modal`. This plugin underlines a misplaced [composurejs](https://www.npmjs.com/package/composurejs) tag in your editor, before you build or send anything, including one given to your own function component (`<Button> cannot go inside <Container> (in <Card>)`), followed into the file it is imported from.

```sh
pnpm add -D @composurejs/eslint-plugin
```

## ESLint

```js
// eslint.config.js
import composure from "@composurejs/eslint-plugin"

export default [composure.configs.recommended]
```

ESLint needs a TypeScript parser (such as `typescript-eslint`) for `.tsx` files.

## oxlint

```json
// .oxlintrc.json
{
  "jsPlugins": ["@composurejs/eslint-plugin"],
  "rules": { "@composurejs/placement": "error" }
}
```

The rule, the build warnings from `@composurejs/vite` and render itself share one set of placement rules from `composurejs`, so all three report the same mistake with the same message.

Guide: [Components](https://bluefrog130.github.io/composure-js/guide/components)
