import { request as httpRequest } from "node:http";
import { env, regressionApp, replayFixtures } from "../../composurejs/test/replay.ts";
import { serve } from "../src/server.ts";

replayFixtures("default server", async (request) => {
  const server = await serve(regressionApp, { port: 0, hostname: "127.0.0.1", env, handleSignals: false });
  try {
    return await overHttp(new URL(new URL(request.url).pathname, server.url), request);
  } finally {
    await server.close();
  }
});

// node:http rather than fetch: fetch refuses "bad ports" (6666, ...) that port 0 can hand out.
async function overHttp(url: URL, request: Request): Promise<Response> {
  const body = request.method === "GET" ? undefined : Buffer.from(await request.arrayBuffer());
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: request.method, headers: Object.fromEntries(request.headers) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode!, headers: res.headers as Record<string, string> })),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}
