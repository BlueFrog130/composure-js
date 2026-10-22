import { CredentialsError } from "./errors.ts"

export const SIGNATURE_HEADER = "X-Signature-Ed25519"
export const TIMESTAMP_HEADER = "X-Signature-Timestamp"

// One import per distinct key per isolate (ADR 0007).
const keys = new Map<string, Promise<CryptoKey>>()

function importPublicKey(hex: string): Promise<CryptoKey> {
  let key = keys.get(hex)
  if (!key) {
    const bytes = hex.length === 64 ? fromHex(hex) : undefined
    if (!bytes) return Promise.reject(new CredentialsError("Public key must be 64 hex characters"))
    key = crypto.subtle.importKey("raw", bytes, { name: "Ed25519" }, false, ["verify"])
    key.catch(() => keys.delete(hex))
    keys.set(hex, key)
  }
  return key
}

export interface VerifyOptions {
  /** Oldest accepted `X-Signature-Timestamp`, in seconds; `Infinity` disables the check. */
  maxAge?: number
  /** Current time in ms. */
  now?: number
}

/**
 * Checks Discord's Ed25519 signature over `timestamp || body`, and that the timestamp is recent.
 * Throws {@link CredentialsError} only for a malformed public key; a bad request is `false`.
 */
export async function verifySignature(
  publicKey: string,
  signature: string | null,
  timestamp: string | null,
  body: Uint8Array,
  { maxAge = 300, now = Date.now() }: VerifyOptions = {},
): Promise<boolean> {
  const key = await importPublicKey(publicKey)
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > maxAge) return false
  const sig = signature.length === 128 ? fromHex(signature) : undefined
  if (!sig) return false

  const stamp = new TextEncoder().encode(timestamp)
  const message = new Uint8Array(stamp.length + body.length)
  message.set(stamp)
  message.set(body, stamp.length)
  return crypto.subtle.verify({ name: "Ed25519" }, key, sig, message)
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return undefined
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}
