import { SIGNATURE_HEADER, TIMESTAMP_HEADER, fromHex, toHex } from "../verify.ts"

// PKCS#8 wrapping of a raw 32-byte Ed25519 seed.
const PKCS8_PREFIX = fromHex("302e020100300506032b657004220420")!

export interface SignedRequestInit {
  url?: string
  /** Seconds since the epoch, as Discord sends it. Default now. */
  timestamp?: string
  headers?: Record<string, string>
}

/** An Ed25519 key that signs requests the way Discord does, for tests. */
export class TestKey {
  readonly #privateKey: CryptoKey

  private constructor(
    /** Hex public key; use as `Credentials.publicKey`. */
    readonly publicKey: string,
    privateKey: CryptoKey,
  ) {
    this.#privateKey = privateKey
  }

  /** A deterministic key, so signatures are reproducible. */
  static async fromSeed(seed: Uint8Array): Promise<TestKey> {
    if (seed.length !== 32) throw new Error("An Ed25519 seed is 32 bytes")
    const der = new Uint8Array(PKCS8_PREFIX.length + 32)
    der.set(PKCS8_PREFIX)
    der.set(seed, PKCS8_PREFIX.length)
    const privateKey = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"])
    const { x } = await crypto.subtle.exportKey("jwk", privateKey)
    return new TestKey(toHex(fromBase64Url(x!)), privateKey)
  }

  static generate(): Promise<TestKey> {
    return TestKey.fromSeed(crypto.getRandomValues(new Uint8Array(32)))
  }

  /** Discord's signature headers for `body`. */
  async sign(body: string | Uint8Array, timestamp = String(Math.floor(Date.now() / 1000))): Promise<Record<string, string>> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
    const stamp = new TextEncoder().encode(timestamp)
    const message = new Uint8Array(stamp.length + bytes.length)
    message.set(stamp)
    message.set(bytes, stamp.length)
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, this.#privateKey, message))
    return { [SIGNATURE_HEADER]: toHex(signature), [TIMESTAMP_HEADER]: timestamp }
  }

  /** A signed POST carrying `body`, as Discord would send it. */
  async request(body: string, init: SignedRequestInit = {}): Promise<Request> {
    return new Request(init.url ?? "https://bot.test/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await this.sign(body, init.timestamp)), ...init.headers },
      body,
    })
  }
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
}
