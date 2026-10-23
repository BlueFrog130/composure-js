import { readdirSync } from "node:fs"
import { transformerTwoslash } from "@shikijs/vitepress-twoslash"
import { defineConfig } from "vitepress"

// Every ```ts twoslash / ```tsx twoslash block is compiled against the built packages: a type
// error fails `pnpm -C docs build`, so the docs cannot drift from the API (kickoff lesson 19).
const adrs = readdirSync(new URL("../adr/", import.meta.url))
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map((f) => ({ text: f.slice(0, 4) + " " + f.slice(5, -3).replace(/-/g, " "), link: `/adr/${f.slice(0, -3)}` }))

export default defineConfig({
  title: "composurejs",
  description: "Discord bots over HTTP Interactions, on any fetch runtime",
  base: "/composure-js/",
  cleanUrls: true,
  srcExclude: ["**/README.md"],
  markdown: {
    codeTransformers: [
      transformerTwoslash({
        throws: true,
        twoslashOptions: {
          compilerOptions: {
            jsx: 4, // react-jsx
            jsxImportSource: "composurejs",
            module: 200, // preserve
            moduleResolution: 100, // bundler
            target: 10, // es2023
            lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
            strict: true,
            skipLibCheck: true,
            allowImportingTsExtensions: true,
            noEmit: true,
            types: ["node"],
          },
        },
      }),
    ],
    languages: ["js", "jsx", "ts", "tsx"],
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Decisions", link: "/adr/0001-explicit-registration" },
      { text: "GitHub", link: "https://github.com/BlueFrog130/composure-js" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Commands", link: "/guide/commands" },
            { text: "Responses", link: "/guide/responses" },
            { text: "Components", link: "/guide/components" },
            { text: "Handlers and Views", link: "/guide/views" },
            { text: "Deferring", link: "/guide/deferring" },
            { text: "REST", link: "/guide/rest" },
            { text: "Webhook Events", link: "/guide/events" },
            { text: "Middleware", link: "/guide/middleware" },
            { text: "Logging", link: "/guide/logging" },
            { text: "Platforms", link: "/guide/platforms" },
            { text: "Local development", link: "/guide/local-dev" },
            { text: "Deploying", link: "/guide/deploying" },
            { text: "Testing", link: "/guide/testing" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/adr/": [{ text: "Architecture decisions", items: adrs }],
    },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/BlueFrog130/composure-js" }],
  },
})
