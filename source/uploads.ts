import { isUploadFile, type SystemUploads, type Upload } from "@phreshos/core"
import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, mkdirSync } from "node:fs"
import { rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { content } from "./storage.js"
import wire from "./wire.js"

/** Flat upload access performed locally by a Server Endpoint. */
class ServerUploads implements SystemUploads {
  private accessPromise: Promise<Access> | null = null

  public async write(value: unknown): Promise<Upload> {
    const access = await this.access()
    const source = content(value)
    const identity = randomUUID()
    const file = `${identity}.${source.extension}`
    const temporary = join(access.root, `.${identity}.uploading`)
    const destination = join(access.root, file)
    let size = 0

    mkdirSync(access.root, { recursive: true })

    try {
      await pipeline(
        Readable.fromWeb(source.stream as unknown as NodeReadableStream<Uint8Array>),
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            size += chunk.byteLength
            if (size > access.limit) throw new Error(`The upload exceeds ${access.limit / 1024 / 1024 / 1024} GB`)
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

    const upload = await this.stat(file)

    if (!upload) throw new Error("The completed upload could not be described")

    return upload
  }

  public async stream(file: string): Promise<ReadableStream<Uint8Array>> {
    requireFile(file)
    const { root } = await this.access()
    return Readable.toWeb(createReadStream(join(root, file))) as unknown as ReadableStream<Uint8Array>
  }

  public async bytes(file: string) {
    return new Uint8Array(await new Response(await this.stream(file)).arrayBuffer())
  }

  public async text(file: string) {
    return new Response(await this.stream(file)).text()
  }

  public async json<Value>(file: string) {
    return JSON.parse(await this.text(file)) as Value
  }

  public async stat(file: string): Promise<Upload | null> {
    requireFile(file)
    const answer = await wire.request(["uploads", "stat", file]) as [Upload | null]
    return answer[0]
  }

  private access() {
    if (!this.accessPromise) {
      const resolving = wire.request(["uploads", "access"]).then(answer => {
        const [root, limit] = answer as [unknown, unknown]

        if (typeof root !== "string" || !root || typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
          throw new Error("The System returned invalid upload access")
        }

        return { root, limit }
      })
      const retained = resolving.catch(error => {
        if (this.accessPromise === retained) this.accessPromise = null
        throw error
      })

      this.accessPromise = retained
    }

    return this.accessPromise
  }
}

function requireFile(file: string) {
  if (!isUploadFile(file)) throw new Error("That is not an upload file")
}

interface Access {
  root: string
  limit: number
}

export const uploads = new ServerUploads()
