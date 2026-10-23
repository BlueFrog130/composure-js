// Replays the signed fixtures against one entry point: core's here (regression.test.ts), the
// Default Server's in packages/vite/test/server.test.ts.
import { describe, expect, test, vi } from "vitest";
import { cases, requestFor } from "./fixtures.tsx";

export { env, regressionApp } from "./fixtures.tsx";

export function replayFixtures(name: string, fetch: (request: Request) => Promise<Response>): void {
  describe(`signed fixtures over ${name}`, () => {
    test.each(cases.map((c) => [c.name, c] as const))("%s", async (_, kase) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "debug").mockImplementation(() => {});
      const response = await fetch(await requestFor(kase));
      expect(response.status).toBe(kase.status);
      if (kase.response !== undefined) expect(await response.json()).toEqual(kase.response);
    });
  });
}
