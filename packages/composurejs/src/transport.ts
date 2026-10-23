// REST goes through an injectable Transport (ADR 0006): one request in, one response out.
import type { Upload } from "./components.ts";

export type Transport = (request: Request) => Promise<Response>;

export const DISCORD_API = "https://discord.com/api/v10";

export const fetchTransport: Transport = (request) => fetch(request);

/** The `attachments` metadata matching `files[n]`. */
export function attachmentsOf(files: readonly Upload[]): { id: number; filename: string; description?: string }[] {
  return files.map((f, id) => ({ id, filename: f.name, ...(f.description !== undefined && { description: f.description }) }));
}

/** A multipart body: `payload_json` plus `files[n]`. The JSON must already carry `attachments`. */
export function formData(json: unknown, files: readonly Upload[]): FormData {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(json));
  files.forEach((f, i) => form.append(`files[${i}]`, toBlob(f), f.name));
  return form;
}

/** An interaction callback as multipart, with `attachments` in its `data`. */
export function multipart(payload: { data?: object }, files: readonly Upload[]): FormData {
  return formData({ ...payload, data: { ...payload.data, attachments: attachmentsOf(files) } }, files);
}

function toBlob(file: Upload): Blob {
  const options = file.contentType ? { type: file.contentType } : {};
  return file.data instanceof Blob ? file.data : new Blob([file.data as BlobPart], options);
}
