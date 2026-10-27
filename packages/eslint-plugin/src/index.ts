// The editor half of the placement checks (ADR 0023): one ESLint rule over composurejs/placement,
// the same check @composurejs/vite warns with at build time. oxlint loads it as a JS plugin.
import { readFileSync, statSync } from "node:fs";
import { type AstNode, checkPlacement } from "composurejs/placement";
import type { ESLint, Linter, Rule } from "eslint";
import { parseSync } from "oxc-parser";
import pkg from "../package.json" with { type: "json" };

const loaded = new Map<string, { mtime: number; program: AstNode | undefined }>();

/**
 * A module a function component is imported from (ADR 0032), as saved on disk: the editor's unsaved
 * text is not seen. Cached until the file changes.
 */
function load(path: string): AstNode | undefined {
  try {
    const { mtimeMs } = statSync(path);
    const cached = loaded.get(path);
    if (cached && cached.mtime === mtimeMs) return cached.program;
    const { program, errors } = parseSync(path, readFileSync(path, "utf8"));
    const parsed = errors.length > 0 ? undefined : (program as unknown as AstNode);
    loaded.set(path, { mtime: mtimeMs, program: parsed });
    return parsed;
  } catch {
    return undefined;
  }
}

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
        for (const problem of checkPlacement(program as unknown as AstNode, { file: context.physicalFilename, load })) {
          context.report({ node: problem.node as unknown as Rule.Node, message: problem.message });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: pkg.name, version: pkg.version },
  rules: { placement },
  configs: {} as Record<"recommended", Linter.Config>,
} satisfies ESLint.Plugin;

/** `export default [composure.configs.recommended]` in `eslint.config.js`. */
plugin.configs.recommended = {
  name: "@composurejs/recommended",
  plugins: { "@composurejs": plugin },
  rules: { "@composurejs/placement": "error" },
};

export default plugin;
