import type { EntryStat, ProgramSql, ProgramStore, Storage as CoreStorage } from "@phreshos/core"
import { randomUUID } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  lstatSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from "node:fs"
import { rm } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import wire from "./wire.js"
import type { HandleAddress } from "./domain.js"

export interface Storage extends CoreStorage {
  path(): Promise<string>
  resolve(...path: string[]): Promise<string>
}

/** Server-local implementation of one Program-owned filesystem area. */
export function area(program: HandleAddress, which: "data" | "cache"): Storage {
  async function path() {
    const answer = await wire.request([which, program, "path"]) as [string]
    return answer[0]
  }

  async function resolve(...parts: string[]) {
    const root = await path()
    return contained(root, parts)
  }

  async function stream(...parts: string[]) {
    const destination = await resolve(...parts)
    const found = describe(destination)

    if (!found) throw new Error(`There is no ${parts.join("/")} in this Program's ${which}`)
    if (found.kind !== "file") throw new Error(`${parts.join("/")} is not a file`)

    return Readable.toWeb(createReadStream(destination)) as unknown as ReadableStream<Uint8Array>
  }

  async function write(...args: [...path: string[], value: unknown]) {
    if (args.length < 2) throw new Error("Writing takes a file name and what to write")

    const parts = args.slice(0, -1) as string[]
    const destination = await resolve(...parts)
    const temporary = join(dirname(destination), `.${randomUUID()}.writing`)

    mkdirSync(dirname(destination), { recursive: true })

    try {
      await pipeline(
        Readable.fromWeb(content(args.at(-1)).stream as unknown as NodeReadableStream<Uint8Array>),
        createWriteStream(temporary, { flags: "wx" })
      )
      renameSync(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  return {
    path,
    resolve,
    stream,
    async bytes(...parts) {
      return new Uint8Array(await new Response(await stream(...parts)).arrayBuffer())
    },
    async text(...parts) {
      return new Response(await stream(...parts)).text()
    },
    async json<Value>(...parts: string[]) {
      return JSON.parse(await new Response(await stream(...parts)).text()) as Value
    },
    write,
    async stat(...parts) {
      return describe(await resolve(...parts))
    },
    async list(...parts) {
      return readdirSync(await resolve(...parts)).sort()
    },
    async delete(...parts) {
      if (!parts.length) throw new Error("Emptying a place is clear, not delete")
      rmSync(await resolve(...parts), { recursive: true, force: true })
    },
    async clear(...parts) {
      const destination = await resolve(...parts)
      const found = describe(destination)

      if (found && found.kind !== "directory") throw new Error("Only a storage directory can be cleared")

      rmSync(destination, { recursive: true, force: true })
      mkdirSync(destination, { recursive: true })
    }
  }
}

function contained(root: string, parts: string[]) {
  const destination = join(root, ...parts)
  const step = relative(root, destination)

  if (step === ".." || step.startsWith(`..${sep}`) || isAbsolute(step)) {
    throw new Error("A storage path may not leave its configured directory")
  }

  let current = root

  for (const part of step.split(sep).filter(Boolean)) {
    current = join(current, part)

    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error("A storage path may not pass through a symbolic link")
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break
      throw error
    }
  }

  return destination
}

export function store(program: HandleAddress): ProgramStore {
  async function ask<Result>(operation: string, ...values: unknown[]) {
    const answer = await wire.request(["store", program, operation, ...values]) as [Result]
    return answer[0]
  }

  return {
    get: <Value>(key: string) => ask<Value | undefined>("get", key),
    set: <Value>(key: string, value: Value, ttl?: number) => ask<boolean>("set", key, value, ttl),
    delete: (key: string | string[]) => ask<boolean>("delete", key),
    has: (key: string) => ask<boolean>("has", key),
    clear: () => ask<void>("clear")
  }
}

export function sql(kind: "database" | "logs", program: HandleAddress): ProgramSql {
  return {
    async query<Row = Record<string, unknown>>(statement: string | TemplateStringsArray, ...rest: unknown[]) {
      const [text, values] = written(statement, rest)
      const answer = await wire.request([kind, program, text, values]) as [Row[]]
      return answer[0]
    }
  }
}

export function content(value: unknown): { stream: ReadableStream<Uint8Array>, extension: string, type: string } {
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
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return { stream: new Blob([bytes.slice()]).stream(), extension: "bin", type: binary }
  }

  const json = JSON.stringify(value)
  if (json === undefined) throw new Error("This value cannot be written as JSON")
  return { stream: new Blob([json]).stream(), extension: "json", type: "application/json" }
}

function describe(path: string): EntryStat | null {
  let found

  try {
    found = statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }

  const modifiedAt = Math.round(found.mtimeMs)
  if (found.isFile()) return { kind: "file", size: found.size, modifiedAt }
  if (found.isDirectory()) return { kind: "directory", modifiedAt }
  return { kind: "other", modifiedAt }
}

function written(statement: string | TemplateStringsArray, rest: unknown[]): [string, unknown[]] {
  if (typeof statement === "string") return [statement, Array.isArray(rest[0]) ? rest[0] as unknown[] : []]
  return [statement.raw.join("?"), rest]
}

const extensions: Record<string, string> = {
  "application/gzip": "gz",
  "application/javascript": "js",
  "application/json": "json",
  "application/pdf": "pdf",
  "application/wasm": "wasm",
  "application/zip": "zip",
  "audio/mpeg": "mp3",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "text/css": "css",
  "text/csv": "csv",
  "text/html": "html",
  "text/javascript": "js",
  "text/plain": "txt",
  "video/mp4": "mp4"
}

function extension(name: string, type: string) {
  const named = name.match(/\.([A-Za-z0-9]+)$/)?.[1]
  return named?.toLowerCase() ?? extensions[type.split(";", 1)[0]!.toLowerCase()] ?? "bin"
}
