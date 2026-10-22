import { request as httpRequest } from "node:http"
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
      return await overHttp(new URL(new URL(request.url).pathname, server.url), request)
    } finally {
      await server.close()
    }
  },
}

// node:http rather than fetch: fetch refuses "bad ports" (6666, ...) that port 0 can hand out.
async function overHttp(url: URL, request: Request): Promise<Response> {
  const body = request.method === "GET" ? undefined : Buffer.from(await request.arrayBuffer())
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: request.method, headers: Object.fromEntries(request.headers) }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode!, headers: res.headers as Record<string, string> })))
    })
    req.on("error", reject)
    req.end(body)
  })
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
