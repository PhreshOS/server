import type { WritableContent } from "@phreshos/core"

/** Encodes one writable value without assigning it to Storage or Uploads. */
export function content(value: WritableContent): EncodedContent {
  const binary = "application/octet-stream"

  if (typeof File !== "undefined" && value instanceof File) {
    const type = value.type || binary
    return { stream: value.stream(), extension: extension(value.name, type), type }
  }
  if (value instanceof Blob) {
    const type = value.type || binary
    return { stream: value.stream(), extension: extension("", type), type }
  }
  if (value instanceof ReadableStream) return { stream: value, extension: "bin", type: binary }
  if (typeof value === "string") return { stream: new Blob([value]).stream(), extension: "txt", type: "text/plain" }
  if (value instanceof ArrayBuffer) return { stream: new Blob([value]).stream(), extension: "bin", type: binary }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.byteLength)
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    return { stream: new Blob([bytes]).stream(), extension: "bin", type: binary }
  }

  const json = JSON.stringify(value)
  if (json === undefined) throw new Error("Writable content must have a JSON representation")
  return { stream: new Blob([json]).stream(), extension: "json", type: "application/json" }
}

export interface EncodedContent {
  stream: ReadableStream<Uint8Array>
  extension: string
  type: string
}

const extensions: Readonly<Record<string, string>> = {
  "application/gzip": "gz", "application/javascript": "js", "application/json": "json", "application/pdf": "pdf",
  "application/wasm": "wasm", "application/zip": "zip", "audio/mpeg": "mp3", "image/gif": "gif", "image/jpeg": "jpg",
  "image/png": "png", "image/svg+xml": "svg", "image/webp": "webp", "text/css": "css", "text/csv": "csv",
  "text/html": "html", "text/javascript": "js", "text/plain": "txt", "video/mp4": "mp4"
}

function extension(name: string, type: string) {
  return name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? extensions[type.split(";", 1)[0]!.toLowerCase()] ?? "bin"
}
