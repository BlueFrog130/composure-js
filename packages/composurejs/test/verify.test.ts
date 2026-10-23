import { expect, test } from "vitest";
import { CredentialsError, verifySignature } from "composurejs";
import { TestKey } from "composurejs/testing";

const body = new TextEncoder().encode('{"type":1}');
const now = Date.now();
const ts = String(Math.floor(now / 1000));

test("accepts Discord's signature over timestamp || body", async () => {
  const key = await TestKey.generate();
  const headers = await key.sign(body, ts);
  expect(await verifySignature(key.publicKey, headers["X-Signature-Ed25519"]!, ts, body, { now })).toBe(true);
});

test("rejects tampering, other keys, stale or malformed headers", async () => {
  const key = await TestKey.generate();
  const other = await TestKey.generate();
  const sig = (await key.sign(body, ts))["X-Signature-Ed25519"]!;
  const tampered = new TextEncoder().encode('{"type":2}');
  expect(await verifySignature(key.publicKey, sig, ts, tampered, { now })).toBe(false);
  expect(await verifySignature(other.publicKey, sig, ts, body, { now })).toBe(false);
  expect(await verifySignature(key.publicKey, sig, String(Number(ts) + 1), body, { now })).toBe(false);
  expect(await verifySignature(key.publicKey, null, ts, body, { now })).toBe(false);
  expect(await verifySignature(key.publicKey, "zz", ts, body, { now })).toBe(false);
  expect(await verifySignature(key.publicKey, sig, "soon", body, { now })).toBe(false);
  const old = String(Number(ts) - 301);
  const oldSig = (await key.sign(body, old))["X-Signature-Ed25519"]!;
  expect(await verifySignature(key.publicKey, oldSig, old, body, { now })).toBe(false);
  expect(await verifySignature(key.publicKey, oldSig, old, body, { now, maxAge: Infinity })).toBe(true);
});

test("seeded keys are deterministic", async () => {
  const seed = new Uint8Array(32).fill(7);
  const [a, b] = await Promise.all([TestKey.fromSeed(seed), TestKey.fromSeed(seed)]);
  expect(a.publicKey).toBe(b.publicKey);
  expect(await a.sign(body, ts)).toEqual(await b.sign(body, ts));
});

test("a malformed public key is a CredentialsError", async () => {
  await expect(verifySignature("abc", "00", ts, body)).rejects.toThrow(CredentialsError);
});
