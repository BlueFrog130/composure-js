// Every hand-written Endpoint must exist in Discord's OpenAPI spec (vendored in spec/, pinned in
// spec/PINNED; refresh with scripts/update-spec.mjs). Set PRINT_UNIMPLEMENTED=1 to list the
// operations not implemented yet, outside the OUT_OF_SCOPE prefixes.
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { ROUTES } from "../src/rest/endpoints.ts"

const spec = JSON.parse(readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { operationId?: string }>>
}

/** Route prefixes composurejs does not cover, with why. Each must still exist in the spec. */
const OUT_OF_SCOPE: Record<string, string> = {
  "/gateway": "HTTP Interactions only; no gateway connection",
  "/oauth2": "OAuth2 flows and user-token routes",
  "/users/@me/connections": "OAuth2 user token",
  "/users/@me/applications": "OAuth2 user token (role connections)",
  "/partner-sdk": "Partner SDK",
  "/lobbies": "Social SDK lobbies",
}

const METHODS = ["get", "post", "put", "patch", "delete"]
const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, op]) => ({ method: method.toUpperCase(), path, operationId: op.operationId })),
)

describe("REST Endpoints against the OpenAPI spec", () => {
  test.each(Object.entries(ROUTES))("%s", (_, route) => {
    const op = operations.find((o) => o.method === route.method && o.path === route.path)
    expect(op, `${route.method} ${route.path} is not in the spec`).toBeDefined()
    expect(op!.operationId).toBe(route.op)
  })

  test.each(Object.entries(OUT_OF_SCOPE))("out-of-scope prefix %s still exists (%s)", (prefix) => {
    expect(operations.some((o) => o.path.startsWith(prefix))).toBe(true)
  })

  test("coverage", () => {
    const implemented = new Set(Object.values(ROUTES).map((r) => `${r.method} ${r.path}`))
    const missing = operations.filter((o) => !Object.keys(OUT_OF_SCOPE).some((prefix) => o.path.startsWith(prefix))).filter((o) => !implemented.has(`${o.method} ${o.path}`))
    if (process.env.PRINT_UNIMPLEMENTED) console.info(`Not implemented (${missing.length}):\n${missing.map((o) => `  ${o.method} ${o.path} (${o.operationId})`).join("\n")}`)
    expect(implemented.size).toBe(Object.keys(ROUTES).length)
  })
})
