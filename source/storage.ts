import {
  Storage,
  StorageFile,
  type FileStat,
  type ProgramSql,
  type ProgramStore,
  type StorageChange,
  type StorageListOptions,
  type StorageReadOptions,
  type StorageSpace,
  type StorageStat,
  type StorageTransferOptions,
  type StorageWatchOptions,
  type StorageWriteOptions,
  type WritableContent
} from "@phreshos/core"
import { content } from "./content.js"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Program-owned storage transported through the Server boundary. */
export function area(program: HandleAddress, which: "data" | "cache"): Storage {
  return new RemoteStorage(new ProgramStorageBoundary(program, which), [])
}

/** Native filesystem access transported through the Server boundary. */
export function systemStorage(): Storage {
  return new RemoteStorage(new SystemStorageBoundary(), [])
}

abstract class StorageBoundary {
  public abstract ask<Result>(operation: string, path: readonly string[], input?: unknown): Promise<Result>
  public abstract transfer(operation: "stream" | "write" | "append", path: readonly string[], value?: WritableContent, input?: unknown): Promise<ReadableStream<Uint8Array> | null>
  public abstract watch(path: readonly string[], options: Omit<StorageWatchOptions, "signal">, signal?: AbortSignal): AsyncGenerator<StorageChange, void, void>
}

class ProgramStorageBoundary extends StorageBoundary {
  public constructor(private readonly program: HandleAddress, private readonly area: "data" | "cache") { super() }
  public async ask<Result>(operation: string, path: readonly string[], input?: unknown) {
    const answer = await wire.request([this.area, this.program, operation, [...path], input]) as [Result]
    return answer[0]
  }
  public transfer(operation: "stream" | "write" | "append", path: readonly string[], value?: WritableContent, input?: unknown) {
    return transfer(["storage-content", "program", this.program, this.area, operation], path, value, input)
  }
  public watch(path: readonly string[], options: Omit<StorageWatchOptions, "signal">, signal?: AbortSignal) {
    return watch(["program", this.program, this.area, [...path], options], signal)
  }
}

class SystemStorageBoundary extends StorageBoundary {
  public async ask<Result>(operation: string, path: readonly string[], input?: unknown) {
    const answer = await wire.request(["host-storage", operation, [...path], input]) as [Result]
    return answer[0]
  }
  public transfer(operation: "stream" | "write" | "append", path: readonly string[], value?: WritableContent, input?: unknown) {
    return transfer(["storage-content", "system", operation], path, value, input)
  }
  public watch(path: readonly string[], options: Omit<StorageWatchOptions, "signal">, signal?: AbortSignal) {
    return watch(["system", [...path], options], signal)
  }
}

class RemoteStorage extends Storage {
  public constructor(private readonly boundary: StorageBoundary, private readonly parts: readonly string[]) { super() }
  public name() { return this.boundary.ask<string>("name", this.parts) }
  public path() { return this.boundary.ask<string>("path", this.parts) }
  public navigate(...parts: string[]) { return new RemoteStorage(this.boundary, [...this.parts, ...parts]) }
  public file(...parts: [string, ...string[]]) { return new RemoteStorageFile(this.boundary, [...this.parts, ...parts]) }
  public create() { return this.boundary.ask<void>("create", this.parts) }
  public stat() { return this.boundary.ask<StorageStat | null>("stat-storage", this.parts) }
  public async list(options: StorageListOptions = {}) {
    const values = await this.boundary.ask<unknown>("list", this.parts, options)
    if (!Array.isArray(values)) throw new Error("The System returned an invalid Storage list")
    return values.map(value => {
      const entry = parseEntry(value)
      return entry.kind === "file"
        ? new RemoteStorageFile(this.boundary, [...this.parts, ...entry.path])
        : new RemoteStorage(this.boundary, [...this.parts, ...entry.path])
    })
  }
  public copy(destination: Storage, options: StorageTransferOptions = {}) { return copyStorage(this, destination, options) }
  public async move(destination: Storage, options: StorageTransferOptions = {}) {
    if (await sameLocation(this, destination)) return
    await copyStorage(this, destination, options)
    await this.delete()
  }
  public delete() { return this.boundary.ask<void>("delete-storage", this.parts) }
  public clear() { return this.boundary.ask<void>("clear", this.parts) }
  public space() { return this.boundary.ask<StorageSpace>("space", this.parts) }
  public watch(options: StorageWatchOptions = {}) { return this.boundary.watch(this.parts, { recursive: options.recursive }, options.signal) }
}

class RemoteStorageFile extends StorageFile {
  public constructor(private readonly boundary: StorageBoundary, private readonly parts: readonly string[]) { super() }
  public name() { return this.boundary.ask<string>("name", this.parts) }
  public path() { return this.boundary.ask<string>("path", this.parts) }
  public stat() { return this.boundary.ask<FileStat | null>("stat-file", this.parts) }
  public async stream(options: StorageReadOptions = {}) {
    const body = await this.boundary.transfer("stream", this.parts, undefined, options)
    if (!body) throw new Error("The Storage response has no byte stream")
    return body
  }
  public async bytes(options?: StorageReadOptions) { return collect(await this.stream(options)) }
  public async text(options?: StorageReadOptions) { return new TextDecoder().decode(await this.bytes(options)) }
  public async json<Value>() { return JSON.parse(await this.text()) as Value }
  public async write(value: WritableContent, options: StorageWriteOptions = {}) { await this.boundary.transfer("write", this.parts, value, options) }
  public async append(value: WritableContent) { await this.boundary.transfer("append", this.parts, value) }
  public async copy(destination: StorageFile, options: StorageTransferOptions = {}) {
    if (await sameLocation(this, destination)) return
    await destination.write(await this.bytes(), { overwrite: options.overwrite ?? false })
  }
  public async move(destination: StorageFile, options: StorageTransferOptions = {}) {
    if (await sameLocation(this, destination)) return
    await this.copy(destination, options)
    await this.delete()
  }
  public delete() { return this.boundary.ask<void>("delete-file", this.parts) }
}

async function transfer(prefix: unknown[], path: readonly string[], value?: WritableContent, input?: unknown) {
  const operation = prefix.at(-1)
  if (operation === "stream") return readable(wire.stream([...prefix, [...path], input]))
  const source = content(value as WritableContent)
  for await (const _ of wire.stream([...prefix, [...path], await collect(source.stream), input])) {
    throw new Error("The System returned data for a Storage write")
  }
  return null
}

function watch(values: unknown[], signal?: AbortSignal) {
  const operation = wire.stream(["storage-watch", ...values], undefined, signal)
  return (async function* (): AsyncGenerator<StorageChange, void, void> {
    for await (const value of operation) {
      const change = value as Partial<StorageChange> | null
      if (!change || (change.event !== "change" && change.event !== "rename") || change.path !== null && typeof change.path !== "string") throw new Error("The System returned an invalid Storage change")
      yield Object.freeze({ event: change.event, path: change.path })
    }
  })()
}

function readable(source: AsyncIterable<unknown>) {
  const iterator = source[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) controller.close()
      else controller.enqueue(parseBytes(next.value))
    },
    async cancel() { await iterator.return?.() }
  })
}

async function collect(source: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of source) { const bytes = parseBytes(chunk); chunks.push(bytes); size += bytes.byteLength }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result
}

function parseBytes(value: unknown) {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value)
  throw new Error("The System returned invalid bytes")
}

async function copyStorage(source: Storage, destination: Storage, options: StorageTransferOptions) {
  if (await sameLocation(source, destination)) return
  const [sourcePath, destinationPath] = await Promise.all([source.path(), destination.path()])
  if (normalizePath(destinationPath).startsWith(`${normalizePath(sourcePath)}/`)) throw new Error("A Storage directory cannot be copied inside itself")
  if (!await source.stat()) throw new Error(`There is no Storage directory at ${sourcePath}`)
  if (await destination.stat()) {
    if (!options.overwrite) throw new Error(`A Storage directory already exists at ${destinationPath}`)
    await destination.delete()
  }
  await destination.create()
  for (const entry of await source.list()) {
    const name = await entry.name()
    if (entry instanceof StorageFile) await entry.copy(destination.file(name), options)
    else await entry.copy(destination.navigate(name), options)
  }
}

async function sameLocation(left: { path(): Promise<string> }, right: { path(): Promise<string> }) {
  const [leftPath, rightPath] = await Promise.all([left.path(), right.path()])
  return normalizePath(leftPath) === normalizePath(rightPath)
}
function normalizePath(path: string) { return path.replaceAll("\\", "/").replace(/\/+$/, "") }

function parseEntry(value: unknown): { kind: "storage" | "file", path: string[] } {
  const entry = value as { kind?: unknown, path?: unknown } | null
  if (!entry || (entry.kind !== "storage" && entry.kind !== "file") || !Array.isArray(entry.path) || entry.path.length === 0 || entry.path.some(part => typeof part !== "string")) throw new Error("The System returned an invalid Storage entry")
  return { kind: entry.kind, path: entry.path as string[] }
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
      const text = typeof statement === "string" ? statement : statement.raw.join("?")
      const values = typeof statement === "string" ? (Array.isArray(rest[0]) ? rest[0] : []) : rest
      const answer = await wire.request([kind, program, text, values]) as [Row[]]
      return answer[0]
    }
  }
}
