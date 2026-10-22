// The editor half of the placement checks (ADR 0023): one ESLint rule over composurejs/placement,
// the same check @composurejs/vite warns with at build time. oxlint loads it as a JS plugin.
import { type AstNode, checkPlacement } from "composurejs/placement"
import type { ESLint, Linter, Rule } from "eslint"
import pkg from "../package.json" with { type: "json" }

const placement: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow built-in tags written directly inside a parent Discord does not allow them in",
      url: "https://bluefrog130.github.io/composure-js/guide/components#placement",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(program) {
        for (const problem of checkPlacement(program as unknown as AstNode)) {
          context.report({ node: problem.node as unknown as Rule.Node, message: problem.message })
        }
      },
    }
  },
}

const plugin = {
  meta: { name: pkg.name, version: pkg.version },
  rules: { placement },
  configs: {} as Record<"recommended", Linter.Config>,
} satisfies ESLint.Plugin

/** `export default [composure.configs.recommended]` in `eslint.config.js`. */
plugin.configs.recommended = {
  name: "@composurejs/recommended",
  plugins: { "@composurejs": plugin },
  rules: { "@composurejs/placement": "error" },
}

export default plugin
