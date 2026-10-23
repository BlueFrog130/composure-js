# @composurejs/eslint-plugin

ESLint and oxlint rules for [composurejs](https://www.npmjs.com/package/composurejs): flags built-in tags placed where Discord does not allow them, in the editor.

```js
// eslint.config.js
import composure from "@composurejs/eslint-plugin"

export default [composure.configs.recommended]
```

```json
// .oxlintrc.json
{
  "jsPlugins": ["@composurejs/eslint-plugin"],
  "rules": { "@composurejs/placement": "error" }
}
```

Guide: [https://bluefrog130.github.io/composure-js/guide/components](https://bluefrog130.github.io/composure-js/guide/components)
