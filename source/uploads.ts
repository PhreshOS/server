import { isUploadFile, type FileStat, type SystemUploads, type Upload, type WritableContent } from "@phreshos/core"
import { content } from "./content.js"
import wire from "./wire.js"

/** Flat upload access transported through the Server boundary. */
class ServerUploads implements SystemUploads {
  public async path() {
    const [path] = await wire.request(["uploads", "path"]) as [unknown]
    if (typeof path !== "string" || !path) throw new Error("The System returned an invalid uploads path")
    return path
  }

  public async write(value: WritableContent): Promise<Upload> {
    const source = content(value)
    const [upload] = await wire.request([
      "uploads",
      "write",
      await collect(source.stream),
      { extension: source.extension, type: source.type }
    ]) as [Upload]
    return upload
  }

  public async stream(file: string): Promise<ReadableStream<Uint8Array>> {
    requireFile(file)
    const iterator = wire.stream(["uploads-stream", file])
    return new ReadableStream({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(bytes(next.value))
      },
      async cancel() { await iterator.return?.() }
    })
  }

  public async bytes(file: string) { return collect(await this.stream(file)) }
  public async text(file: string) { return new TextDecoder().decode(await this.bytes(file)) }
  public async json<Value>(file: string) { return JSON.parse(await this.text(file)) as Value }
  public async stat(file: string): Promise<FileStat | null> {
    requireFile(file)
    const [stat] = await wire.request(["uploads", "stat", file]) as [FileStat | null]
    return stat
  }
}

async function collect(source: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of source) { const value = bytes(chunk); chunks.push(value); size += value.byteLength }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

function bytes(value: unknown) {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value)
  throw new Error("The System returned invalid bytes")
}

function requireFile(file: string) {
  if (!isUploadFile(file)) throw new Error("That is not an upload file")
}

export const uploads = new ServerUploads()
