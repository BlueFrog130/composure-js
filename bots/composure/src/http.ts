// JSON GETs to APIs other than Discord's (GitHub, npm), over Bot Data's `http` Transport, so tests
// answer them like Discord's.
import type { Transport } from "composurejs";

/** Sent with every request; GitHub requires one. */
export const USER_AGENT = "composurejs-bot (https://github.com/BlueFrog130/composure-js)";

/** GETs `url` and decodes the JSON body; a non-2xx status is an error naming it. */
export async function getJson<T>(http: Transport, url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await http(new Request(url, { headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers } }));
  if (!response.ok) throw new Error(`GET ${url}: status ${response.status}`);
  return (await response.json()) as T;
}
