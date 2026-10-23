// Finding the cloudflared binary for the Dev Loop's Tunnels (ADR 0031), and starting it.
import { type ChildProcess, spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { accessSync, constants, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"
import { gunzipSync } from "node:zlib"
import { CLOUDFLARED_RELEASE, type CloudflaredRelease } from "./cloudflared-release.ts"

export interface CloudflaredOptions {
  /** The project root: a download goes under its `node_modules/.cache/composurejs/`. */
  root: string
  /** Logs Cloudflare's notice before a download, and the download. */
  log(message: string): void
  /** Where `CLOUDFLARED_PATH` and `PATH` come from (default `process.env`). */
  env?: Record<string, string | undefined>
  /** Downloads the release (default the global `fetch`; tests serve a fake asset). */
  fetch?: typeof globalThis.fetch
  /** The pinned release (default {@link CLOUDFLARED_RELEASE}; tests pin fake assets). */
  release?: CloudflaredRelease
  /** The platform and architecture to download for (default this process's). */
  platform?: string
  arch?: string
}

export { CLOUDFLARED_RELEASE, type CloudflaredRelease }

/** Starts cloudflared with these arguments and extra environment (tests swap in a stand-in). */
export type SpawnCloudflared = (args: string[], env: Record<string, string>) => ChildProcess

/** Starts `binary` (from {@link resolveCloudflared}), its output piped. */
export const spawnCloudflared =
  (binary: string): SpawnCloudflared =>
  (args, env) =>
    spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } })

/** The cloudflared to run: `CLOUDFLARED_PATH`, else `cloudflared` on `PATH`, else the pinned release (cached, or downloaded and verified). */
export async function resolveCloudflared(options: CloudflaredOptions): Promise<string> {
  const env = options.env ?? process.env
  if (env.CLOUDFLARED_PATH) return env.CLOUDFLARED_PATH
  const found = onPath(env)
  if (found) return found
  const release = options.release ?? CLOUDFLARED_RELEASE
  const target = `${options.platform ?? process.platform}-${options.arch ?? process.arch}`
  const asset = release.assets[target]
  if (!asset) throw new Error(`cloudflared is not installed and no release is pinned for ${target}: install it, or set CLOUDFLARED_PATH`)
  const file = join(options.root, "node_modules", ".cache", "composurejs", `cloudflared-${release.version}`, asset.file.endsWith(".exe") ? "cloudflared.exe" : "cloudflared")
  if (existsSync(file)) return file
  options.log(NOTICE)
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${release.version}/${asset.file}`
  options.log(`downloading cloudflared ${release.version} (${asset.file})`)
  const response = await (options.fetch ?? fetch)(url)
  if (!response.ok) throw new Error(`downloading cloudflared from ${url} failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== asset.sha256) throw new Error(`${asset.file} does not match its pinned SHA-256 (${asset.sha256}, got ${actual}): not kept`)
  const binary = asset.file.endsWith(".tgz") ? fromTarball(bytes, asset.file) : bytes
  // Written beside it, then renamed: a half-written binary is never found in the cache.
  mkdirSync(dirname(file), { recursive: true })
  const partial = `${file}.${process.pid}-${randomUUID()}.partial`
  writeFileSync(partial, binary, { mode: 0o755 })
  renameSync(partial, file)
  return file
}

/** Cloudflare's terms, which a download accepts. */
const NOTICE = `cloudflared is not installed: downloading it from GitHub accepts Cloudflare's License, Terms and Privacy Policy.
  License:        https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/license/
  Terms:          https://www.cloudflare.com/terms/
  Privacy Policy: https://www.cloudflare.com/privacypolicy/`

/** The `cloudflared` file in a gzipped tar (macOS's asset), read without a `tar` dependency. */
function fromTarball(tgz: Uint8Array, name: string): Uint8Array {
  const tar = gunzipSync(tgz)
  const text = (start: number, length: number) => tar.toString("latin1", start, start + length).replace(/\0.*$/s, "")
  for (let offset = 0; offset + 512 <= tar.length;) {
    const path = text(offset, 100)
    if (!path) break
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8)
    const type = text(offset + 156, 1)
    if ((type === "" || type === "0") && path.split("/").at(-1) === "cloudflared") return tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error(`${name} has no cloudflared inside`)
}

/** `cloudflared` in a `PATH` directory: on Windows only `cloudflared.exe`, the one `spawn` runs without a shell. */
function onPath(env: Record<string, string | undefined>): string | undefined {
  const windows = process.platform === "win32"
  // Windows names it Path, and its variables are case-insensitive.
  const path = windows ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] : env.PATH
  for (const dir of (path ?? "").split(delimiter)) {
    const file = dir && join(dir, windows ? "cloudflared.exe" : "cloudflared")
    if (file && isExecutable(file)) return file
  }
  return undefined
}

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
