import { describe, expect, test, vi } from "vitest"
import { handle as bun } from "composurejs/bun"
import { handle as cloudflare } from "composurejs/cloudflare"
import { serve } from "composurejs/node"
import { cases, env, regressionApp, requestFor } from "./fixtures.tsx"

// Each Adapter, driven through its own entry point.
const adapters: Record<string, (request: Request) => Promise<Response>> = {
  cloudflare: (request) => cloudflare(regressionApp).fetch(request, env, { waitUntil() {} }),
  bun: (request) => bun(regressionApp, { env, handleSignals: false }).fetch(request),
  node: async (request) => {
    const server = await serve(regressionApp, { port: 0, hostname: "127.0.0.1", env, handleSignals: false })
    try {
      const url = new URL(new URL(request.url).pathname, server.url)
      const body = request.method === "GET" ? undefined : await request.arrayBuffer()
      return await fetch(url, { method: request.method, headers: request.headers, ...(body && { body }) })
    } finally {
      await server.close()
    }
  },
}

describe.each(Object.keys(adapters))("signed fixtures over %s", (adapter) => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", async (_, kase) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "debug").mockImplementation(() => {})
    const response = await adapters[adapter]!(await requestFor(kase))
    expect(response.status).toBe(kase.status)
    if (kase.response !== undefined) expect(await response.json()).toEqual(kase.response)
  })
})
