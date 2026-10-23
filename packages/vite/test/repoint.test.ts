// Repoint on its own, for what takes too long to wait out in `vite dev`: the 65 s retry after a
// 400 and the probe's limit. The far end is a local HTTP server; Discord a recording Transport.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { repoint } from "../src/repoint.ts";
import { StageError } from "../src/stage.ts";

const APP_ID = "1052322265397739523";
const PUBLIC_KEY = "a".repeat(64);

let far: Server | undefined;
afterEach(() => far?.close());

/** A tunnel's far end answering every request with `status`. */
async function farEnd(status: number) {
  far = createServer((_req, res) => res.writeHead(status).end());
  await new Promise<void>((resolve) => far!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(far.address() as AddressInfo).port}` };
}

function discord(patch: () => Response) {
  const calls: string[] = [];
  const transport = async (request: Request) => {
    calls.push(request.method);
    if (request.method === "PATCH") return patch();
    return Response.json({ id: APP_ID, verify_key: PUBLIC_KEY });
  };
  return { calls, transport };
}

const rejected = () => Response.json({ code: 50035, message: "Invalid Form Body" }, { status: 400 });

describe("Repoint", { timeout: 10_000 }, () => {
  test("a 400 with the application's own public key retries once after 65s, then fails with the hint", async () => {
    const { calls, transport } = discord(rejected);
    const slept: number[] = [];
    const logs: string[] = [];
    const failure = await repoint({
      tunnel: await farEnd(401),
      application: APP_ID,
      token: "t",
      publicKey: PUBLIC_KEY,
      transport,
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      sleep: async (ms) => void slept.push(ms),
    }).catch((error: unknown) => error);
    expect(calls).toEqual(["GET", "PATCH", "PATCH"]);
    expect(slept).toEqual([65_000]);
    expect(failure).toBeInstanceOf(StageError);
    expect((failure as StageError).stage).toBe("repoint");
    expect((failure as StageError).message).toContain("Invalid Form Body");
    expect((failure as StageError).message).toContain("must answer Discord's signed PING");
  });

  test("a 400 then success after the retry points the endpoint", async () => {
    let failures = 1;
    const { calls, transport } = discord(() => (failures-- > 0 ? rejected() : Response.json({})));
    const logs: string[] = [];
    await repoint({
      tunnel: await farEnd(401),
      application: APP_ID,
      token: "t",
      publicKey: PUBLIC_KEY,
      transport,
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      sleep: async () => {},
    });
    expect(calls).toEqual(["GET", "PATCH", "PATCH"]);
    expect(logs.at(-1)).toContain(`Dev Application ${APP_ID} →`);
  });

  test("a probe that never gets its 401 fails within its limit, naming the stage and the last answer", async () => {
    const { calls, transport } = discord(() => Response.json({}));
    const tunnel = await farEnd(502);
    const slept: number[] = [];
    const failure = await repoint({
      tunnel,
      application: APP_ID,
      token: "t",
      publicKey: PUBLIC_KEY,
      transport,
      info: () => {},
      warn: () => {},
      probeLimit: 500,
      probeInterval: 50,
      sleep: (ms) => {
        slept.push(ms);
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    }).catch((error: unknown) => error);
    // The probe waits between attempts with the injected sleep.
    expect(slept.length).toBeGreaterThan(0);
    expect(new Set(slept)).toEqual(new Set([50]));
    expect(failure).toBeInstanceOf(StageError);
    expect((failure as StageError).stage).toBe("probe");
    expect((failure as StageError).message).toBe(`no 401 from ${tunnel.url}/interactions within 0.5s (last: HTTP 502)`);
    expect(calls).toEqual(["GET"]);
  });
});
