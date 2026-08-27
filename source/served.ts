import type { ServedFile } from "@phreshos/core"
import { randomUUID } from "node:crypto"
import { createWriteStream, mkdirSync, statSync } from "node:fs"
import { rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { content } from "./storage.js"
import wire from "./wire.js"

/** Writes one public value directly into the system-managed served-file area. */
export default async function serve(value: unknown): Promise<ServedFile> {
  const answer = await wire.request(["serve"]) as [string, number]
  const [root, limit] = answer
  const source = content(value)
  const identity = randomUUID()
  const file = `${identity}.${source.extension}`
  const temporary = join(root, `.${identity}.serving`)
  const destination = join(root, file)
  let size = 0

  mkdirSync(root, { recursive: true })

  try {
    await pipeline(
      Readable.fromWeb(source.stream as unknown as NodeReadableStream<Uint8Array>),
      async function* (chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          size += chunk.byteLength
          if (size > limit) throw new Error(`The served value exceeds ${limit / 1024 / 1024 / 1024} GB`)
          yield chunk
        }
      },
      createWriteStream(temporary, { flags: "wx" })
    )
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }

  return {
    file,
    type: source.type,
    size,
    time: Math.round(statSync(destination).mtimeMs)
  }
}
