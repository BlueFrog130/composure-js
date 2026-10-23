import { DISCORD_API, type Transport } from "../transport.ts";

/** A file sent in a multipart request. */
export interface RecordedFile {
  /** Form field, e.g. `files[0]`. */
  field: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface RecordedRequest {
  method: string;
  /** The path after the API base, e.g. `/interactions/123/abc/callback`. */
  path: string;
  headers: Headers;
  /** The JSON body, or a multipart request's `payload_json`. */
  json: unknown;
  files: RecordedFile[];
}

/** A Transport that records requests and answers from a queue (204 when it is empty). Never touches the network. */
export class MockTransport {
  readonly requests: RecordedRequest[] = [];
  readonly #queue: (Response | Error | "hang")[] = [];

  /** Queues the answer to the next unanswered request. */
  reply(status = 200, body?: unknown, headers: Record<string, string> = {}): this {
    const init = { status, headers: body === undefined ? headers : { "content-type": "application/json", ...headers } };
    this.#queue.push(new Response(body === undefined ? null : JSON.stringify(body), init));
    return this;
  }

  /** Fails the next unanswered request as a network error would. */
  fail(error: Error = new TypeError("fetch failed")): this {
    this.#queue.push(error);
    return this;
  }

  /** Never answers the next unanswered request, until it is aborted (a timeout). */
  hang(): this {
    this.#queue.push("hang");
    return this;
  }

  readonly fetch: Transport = async (request) => {
    const url = request.url;
    const recorded: RecordedRequest = {
      method: request.method,
      path: url.startsWith(DISCORD_API) ? url.slice(DISCORD_API.length) : url,
      headers: request.headers,
      json: undefined,
      files: [],
    };
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      for (const [field, value] of form) {
        if (typeof value === "string") {
          if (field === "payload_json") recorded.json = JSON.parse(value);
        } else {
          recorded.files.push({ field, name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
        }
      }
    } else if (type.includes("application/json")) {
      recorded.json = await request.json();
    }
    this.requests.push(recorded);
    const next = this.#queue.shift() ?? new Response(null, { status: 204 });
    if (next instanceof Error) throw next;
    if (next === "hang") {
      return new Promise<Response>((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason as Error)));
    }
    return next;
  };
}
