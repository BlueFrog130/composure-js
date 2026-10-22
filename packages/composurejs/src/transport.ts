// REST goes through an injectable Transport (ADR 0006): one request in, one response out.
import type { Upload } from "./components.ts"

export type Transport = (request: Request) => Promise<Response>

export const DISCORD_API = "https://discord.com/api/v10"

export const fetchTransport: Transport = (request) => fetch(request)

/** A multipart body: `payload_json` plus `files[n]`, with `attachments` metadata filled in. */
export function multipart(payload: { data?: object }, files: readonly Upload[]): FormData {
  const attachments = files.map((f, id) => ({ id, filename: f.name, ...(f.description !== undefined && { description: f.description }) }))
  const form = new FormData()
  form.append("payload_json", JSON.stringify({ ...payload, data: { ...payload.data, attachments } }))
  files.forEach((f, i) => form.append(`files[${i}]`, toBlob(f), f.name))
  return form
}

function toBlob(file: Upload): Blob {
  const options = file.contentType ? { type: file.contentType } : {}
  return file.data instanceof Blob ? file.data : new Blob([file.data as BlobPart], options)
}
