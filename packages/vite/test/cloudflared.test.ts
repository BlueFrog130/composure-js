// Finding the cloudflared binary (ADR 0031): CLOUDFLARED_PATH, then PATH, then the cache, then a
// pinned release, downloaded through an injected fetch serving a fake asset: nothing leaves the machine.
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterEach, describe, expect, test } from "vitest"
import { CLOUDFLARED_RELEASE, resolveCloudflared } from "../src/cloudflared.ts"

const dirs: string[] = []
afterEach(() => void dirs.splice(0))

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "composure-cloudflared-"))
  dirs.push(dir)
  return dir
}

/** A directory holding an executable named cloudflared, as an install would put on PATH. */
function installed(): { dir: string; bin: string } {
  const dir = tempDir()
  const bin = join(dir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared")
  writeFileSync(bin, "installed")
  chmodSync(bin, 0o755)
  return { dir, bin }
}

/** A fetch that fails the test if called. */
const noFetch: typeof fetch = async (input) => {
  throw new Error(`unexpected fetch ${String(input)}`)
}

describe("resolveCloudflared", () => {
  test("CLOUDFLARED_PATH wins over cloudflared on PATH", async () => {
    const { dir } = installed()
    const path = await resolveCloudflared({ root: tempDir(), log: () => {}, fetch: noFetch, env: { CLOUDFLARED_PATH: "/opt/cf/cloudflared", PATH: dir } })
    expect(path).toBe("/opt/cf/cloudflared")
  })

  test("cloudflared on PATH is used without downloading", async () => {
    const { dir, bin } = installed()
    const path = await resolveCloudflared({ root: tempDir(), log: () => {}, fetch: noFetch, env: { PATH: [tempDir(), dir].join(delimiter) } })
    expect(path).toBe(bin)
  })

  test("without one installed, logs Cloudflare's notice, then downloads the pinned release and keeps it in the cache", async () => {
    const root = tempDir()
    const events: string[] = []
    const path = await resolveCloudflared({
      root,
      log: (m) => events.push(`log ${m}`),
      fetch: serve(events),
      env: { PATH: tempDir() },
      release: RELEASE,
      platform: "linux",
      arch: "x64",
    })
    expect(events[0]).toContain("https://www.cloudflare.com/terms/")
    expect(events).toContain("fetch https://github.com/cloudflare/cloudflared/releases/download/2026.1.0/cloudflared-linux-amd64")
    expect(events.indexOf("fetch https://github.com/cloudflare/cloudflared/releases/download/2026.1.0/cloudflared-linux-amd64")).toBeGreaterThan(0)
    expect(path.startsWith(join(root, "node_modules", ".cache", "composurejs"))).toBe(true)
    expect(readFileSync(path, "utf8")).toBe(LINUX_ASSET)
  })

  test("a cached download is used without the notice or another download, and PATH still wins over it", async () => {
    const root = tempDir()
    const linux = { root, release: RELEASE, platform: "linux", arch: "x64" }
    const downloaded = await resolveCloudflared({ ...linux, log: () => {}, fetch: serve([]), env: { PATH: "" } })
    const logs: string[] = []
    expect(await resolveCloudflared({ ...linux, log: (m) => logs.push(m), fetch: noFetch, env: { PATH: "" } })).toBe(downloaded)
    expect(logs).toEqual([])
    const { dir, bin } = installed()
    expect(await resolveCloudflared({ ...linux, log: () => {}, fetch: noFetch, env: { PATH: dir } })).toBe(bin)
  })

  test("macOS's release is a .tgz: the binary inside it is what's kept", async () => {
    const asset = tgz({ LICENSE: "Apache-2.0\n", cloudflared: DARWIN_BINARY })
    const release = { version: "2026.1.0", assets: { "darwin-arm64": { file: "cloudflared-darwin-arm64.tgz", sha256: sha256(asset) } } }
    const path = await resolveCloudflared({
      root: tempDir(),
      log: () => {},
      fetch: serve([], { "cloudflared-darwin-arm64.tgz": asset }),
      env: { PATH: "" },
      release,
      platform: "darwin",
      arch: "arm64",
    })
    expect(readFileSync(path, "utf8")).toBe(DARWIN_BINARY)
  })

  test("a download whose SHA-256 is not the pinned one is rejected and not kept", async () => {
    const root = tempDir()
    const tampered = serve([], { "cloudflared-linux-amd64": "#!/bin/sh\necho tampered\n" })
    await expect(resolveCloudflared({ root, log: () => {}, fetch: tampered, env: { PATH: "" }, release: RELEASE, platform: "linux", arch: "x64" })).rejects.toThrow(
      `cloudflared-linux-amd64 does not match its pinned SHA-256 (${sha256(LINUX_ASSET)}, got ${sha256("#!/bin/sh\necho tampered\n")}): not kept`,
    )
    expect(filesUnder(join(root, "node_modules"))).toEqual([])
  })
})

const DARWIN_BINARY = "Ïúíþ fake mach-o ".repeat(100)

/** A gzipped POSIX ustar archive of these files, as `tar -czf` writes one. */
function tgz(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const blocks: Buffer[] = []
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write(name, 0)
    header.write("0000755\0", 100)
    header.write("0000000\0", 108)
    header.write("0000000\0", 116)
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124)
    header.write("00000000000\0", 136)
    header.write("        ", 148)
    header.write("0", 156)
    header.write("ustar\0" + "00", 257)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

describe("the pinned release", () => {
  test("has a release asset with a SHA-256 for each platform Node and cloudflared both ship", () => {
    const targets = ["darwin-arm64", "darwin-x64", "linux-arm", "linux-arm64", "linux-ia32", "linux-x64", "win32-arm64", "win32-ia32", "win32-x64"]
    expect(Object.keys(CLOUDFLARED_RELEASE.assets).sort()).toEqual(targets)
    for (const asset of Object.values(CLOUDFLARED_RELEASE.assets)) {
      expect(asset!.file).toMatch(/^cloudflared-(darwin|linux|windows)-[a-z0-9]+(\.tgz|\.exe)?$/)
      expect(asset!.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test("a platform without one says to install cloudflared", async () => {
    await expect(resolveCloudflared({ root: tempDir(), log: () => {}, fetch: noFetch, env: { PATH: "" }, platform: "aix", arch: "ppc64" })).rejects.toThrow(
      "cloudflared is not installed and no release is pinned for aix-ppc64: install it, or set CLOUDFLARED_PATH",
    )
  })
})

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

const LINUX_ASSET = "#!/bin/sh\necho fake cloudflared\n"
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")

/** A pinned release whose table matches the fake assets `serve` returns. */
const RELEASE = {
  version: "2026.1.0",
  assets: {
    "linux-x64": { file: "cloudflared-linux-amd64", sha256: sha256(LINUX_ASSET) },
  },
}

/** GitHub's release downloads, serving the fake assets and recording each request. */
function serve(events: string[], assets: Record<string, string | Uint8Array<ArrayBuffer>> = { "cloudflared-linux-amd64": LINUX_ASSET }): typeof fetch {
  return async (input) => {
    const url = String(input)
    events.push(`fetch ${url}`)
    const file = url.split("/").at(-1)!
    const body = assets[file]
    return body === undefined ? new Response("Not Found", { status: 404 }) : new Response(body)
  }
}
