import {
  Client as CoreClient,
  Endpoint as CoreEndpoint,
  Process as CoreProcess,
  Program as CoreProgram,
  Server as CoreServer,
  type AnswerCapture,
  type AnswerSubscriber,
  type AskCapture,
  type AskSubscriber,
  type Cleanup,
  type ClientDeclaration,
  type EndpointDeclaration,
  type EndpointLifecycle,
  type EventOptions,
  type Exit,
  type Launch,
  type ClientLaunch,
  type ServerLaunch,
  type Outcome,
  type Position,
  type ProgramIconSize,
  type ProgramCommandChunk,
  type Size,
  type SystemClientEntity,
  type SystemEndpointEntity,
  type SystemProcessEntity,
  type SystemProcessRunEvent,
  type SystemProcessRunOptions,
  type SystemProgramEntity,
  type SystemProgramProcess,
  type SystemServerEntity,
  type TrafficMessage,
  type Window as CoreWindow,
  type WindowGeometry,
  type WindowState
} from "@phreshos/core"
import { randomUUID } from "node:crypto"
import Events, { stream } from "./events.js"
import Deadline from "./deadline.js"
import HandleRegistry from "./handle-registry.js"
import { area, sql, store, type Storage } from "./storage.js"
import startup from "./startup.js"
import { programPermissions } from "./permissions.js"
import wire from "./wire.js"

export interface HandleAddress {
  identity: string
  reference: string
}

/** Client-safe Program data transported by the authoritative system. */
export interface EndpointDeclarationRecord {
  start: boolean
  service: boolean
}

export interface ClientDeclarationRecord extends EndpointDeclarationRecord {
  title: string | null
  size: Size | null
  position: Position | null
  layer: ClientDeclaration["layer"]
  minimize: boolean | null
  permissions: ClientDeclaration["permissions"]
}

export interface ProgramRecord {
  reference: string
  identity: string
  installed?: boolean
  name: string
  version: string | null
  description: string | null
  hasAgent: boolean
  server: EndpointDeclarationRecord | null
  client: ClientDeclarationRecord | null
}

/** Process data transported with every Endpoint reference. */
export interface ProcessRecord {
  reference: string
  identity: string
  name: string | null
  program: ProgramRecord
  options: Record<string, string>
  startedAt: string | Date
  server: EndpointRecord | null
  client: EndpointRecord | null
}

export interface EndpointRecord { service: boolean }

export interface EndpointReference {
  kind: "server" | "client"
  process: ProcessRecord
}

export type WindowRecord = WindowState

export type Program = SystemProgramEntity
export type ProgramProcess = SystemProgramProcess
export type ProgramProcessRunEvent = SystemProcessRunEvent
export type ProgramProcessRunOptions = SystemProcessRunOptions
export type Process = SystemProcessEntity
export type Endpoint<Events extends object = {}, Fallback = unknown> = SystemEndpointEntity<Events, Fallback>
export type Server<Events extends object = {}, Fallback = unknown> = SystemServerEntity<Events, Fallback>
export type Client<Events extends object = {}, Fallback = unknown> = SystemClientEntity<Events, Fallback>

/** Server-visible Client-owned Window capability. */
export type Window = CoreWindow

const handles = new HandleRegistry()
const ProgramBase = CoreProgram as unknown as new () => object
const ProcessBase = CoreProcess as unknown as new () => object
const ServerBase = CoreServer as unknown as new () => object
const ClientBase = CoreClient as unknown as new () => object

class ProgramHandle extends ProgramBase {
  public readonly identity: string
  public readonly reference: string
  public readonly data: Storage
  public readonly cache: Storage
  public readonly store
  public readonly logs
  public readonly database
  public readonly startup
  public readonly process: ProgramProcess
  public readonly permissions
  private record: ProgramRecord

  public constructor(record: ProgramRecord) {
    super()
    this.identity = record.identity
    this.reference = record.reference
    this.record = record
    this.data = area(this.address, "data")
    this.cache = area(this.address, "cache")
    this.store = store(this.address)
    this.logs = sql("logs", this.address)
    this.database = sql("database", this.address)
    this.startup = startup(this.address)
    this.permissions = programPermissions(this.address)
    this.process = new ProgramProcessHandle(this.address, record.reference) as unknown as ProgramProcess

    bindEvents(this, scoped("program-host", record.reference, programEvent))
  }

  public get name() { return this.record.name }
  public get version() { return this.record.version }
  public get description() { return this.record.description }
  public get hasAgent() { return this.record.hasAgent }
  public get server() {
    return this.record.server ? declaration(this.record.server) : null
  }
  public get client() {
    return this.record.client ? clientDeclaration(this.record.client) : null
  }
  public get address(): HandleAddress { return { identity: this.identity, reference: this.reference } }

  public update(record: ProgramRecord) {
    if (record.reference !== this.reference) throw new Error("A Program handle cannot become another Program")
    this.record = record
  }

  public async icon(size: ProgramIconSize = "medium") {
    const answer = await wire.request(["icon", this.address, size]) as [number[]]
    return new Blob([Uint8Array.from(answer[0])], { type: "image/png" })
  }

  public async agent() {
    if (!this.hasAgent) return null
    const answer = await wire.request(["program-agent", this.address]) as [string | null]
    return answer[0]
  }

  public async installed() {
    const answer = await wire.request(["installed", this.address]) as [boolean]
    return answer[0]
  }

  public async *install() {
    for await (const value of wire.stream(["install", this.address])) {
      yield programCommandChunk(value)
    }
  }

  public async fork(identity: string) {
    const answer = await wire.request(["fork", this.address, identity]) as [ProgramRecord]
    return program(answer[0])
  }

  public async *uninstall(everything = false) {
    for await (const value of wire.stream(["uninstall", this.address, everything])) {
      yield programCommandChunk(value)
    }
  }

  public async forget() {
    await wire.request(["forget", this.address])
  }

}

function programCommandChunk(value: unknown): ProgramCommandChunk {
  const chunk = value as Partial<ProgramCommandChunk> | null

  if (!chunk || (chunk.stream !== "stdout" && chunk.stream !== "stderr") || typeof chunk.text !== "string") {
    throw new Error("The system returned an invalid Program command chunk")
  }

  return Object.freeze({ stream: chunk.stream, text: chunk.text })
}

function declaration(record: EndpointDeclarationRecord): EndpointDeclaration {
  return Object.freeze({
    start: record.start,
    service: record.service
  })
}

function clientDeclaration(record: ClientDeclarationRecord): ClientDeclaration {
  return Object.freeze({
    ...declaration(record),
    title: record.title,
    size: record.size,
    position: record.position,
    layer: record.layer,
    minimize: record.minimize,
    permissions: Object.freeze(Object.fromEntries(Object.entries(record.permissions).map(([name, values]) => [name, Object.freeze([...values])])))
  })
}

class ProgramProcessHandle {
  public constructor(private readonly address: HandleAddress, reference: string) {
    bindEvents(this, scoped("program-process", reference, programProcessEvent))
  }

  public async list() {
    const answer = await wire.request(["program-process-list", this.address]) as [ProcessRecord[]]
    return answer[0].map(record => process(record))
  }

  public async first() {
    return chronological(await this.list())[0] ?? null
  }

  public async last() {
    return chronological(await this.list()).at(-1) ?? null
  }

  public async find(identityOrName: string) {
    const answer = await wire.request(["program-process-find", this.address, identityOrName]) as [ProcessRecord | null]
    return answer[0] ? process(answer[0]) : null
  }

  public async create(launch: Launch = {}) {
    const answer = await wire.request(["program-process-create", this.address, launch]) as [ProcessRecord]
    return process(answer[0])
  }

  public async *run(launch: Launch = {}, options: ProgramProcessRunOptions = {}) {
    for await (const value of wire.stream(["run", this.address, launch], undefined, options.signal)) {
      yield processRunEvent(value)
    }
  }

  public async findOrCreate(launch: Launch & Readonly<{ name: string }>) {
    const answer = await wire.request(["program-process-find-or-create", this.address, launch]) as [ProcessRecord]
    return process(answer[0])
  }

  public async exitAll() {
    const answer = await wire.request(["program-process-exit-all", this.address]) as [string[]]
    return answer[0]
  }
}

function processRunEvent(value: unknown): ProgramProcessRunEvent {
  const event = value as {
    event?: unknown
    process?: ProcessRecord
    stream?: unknown
    text?: unknown
    exit?: { code?: unknown, signal?: unknown }
  } | null

  if (event?.event === "started" && event.process) {
    return Object.freeze({ event: "started", process: process(event.process) })
  }

  if (event?.event === "output" && (event.stream === "stdout" || event.stream === "stderr") && typeof event.text === "string") {
    return Object.freeze({ event: "output", stream: event.stream, text: event.text })
  }

  if (event?.event === "exited" && event.process) {
    const code = typeof event.exit?.code === "number" ? event.exit.code : null
    const signal = typeof event.exit?.signal === "string" ? event.exit.signal : null
    return Object.freeze({ event: "exited", process: process(event.process), exit: exit(code, signal) })
  }

  throw new Error("The System returned an invalid Process run event")
}

/** Internal transport address for a Program handle created by this SDK. */
export function programAddress(value: Program): HandleAddress {
  if (!(value instanceof ProgramHandle)) throw new Error("A Program handle is required")
  return value.address
}

function chronological(processes: Process[]) {
  return processes.sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
}

class ProcessHandle extends ProcessBase {
  public readonly identity: string
  public readonly reference: string
  public readonly name: string | null
  public readonly startedAt: Date
  public readonly server: Server
  public readonly client: Client
  private readonly ownerProgram: Program
  private readonly options: Record<string, string>

  public constructor(record: ProcessRecord, endpoints: { server?: Server, client?: Client } = {}) {
    super()
    this.identity = record.identity
    this.reference = record.reference
    this.name = record.name
    this.startedAt = new Date(record.startedAt)
    this.ownerProgram = program(record.program)
    this.options = record.options
    this.server = endpointHandle(this, "server", endpoints.server) as Server
    this.client = endpointHandle(this, "client", endpoints.client) as Client

    bindEvents(this, scoped("process-host", record.reference, processEvent))
  }

  public program() { return this.ownerProgram }
  public get address(): HandleAddress { return { identity: this.identity, reference: this.reference } }

  public async parent() {
    const answer = await wire.request(["parent", this.address]) as [ProcessRecord | null]
    return answer[0] ? process(answer[0]) : null
  }

  public async option(name: string) {
    if (name in this.options) return this.options[name]
    const answer = await wire.request(["option", this.address, name]) as [string | undefined]
    return answer[0]
  }

  public async exit() {
    await wire.request(["exit", this.address])
  }

  public async exited() {
    const answer = await wire.request(["exited", this.address]) as [boolean]
    return answer[0]
  }
}

export class TrafficHandle extends Events {
  public constructor(protected readonly target: HandleAddress | null, protected readonly kind: "server" | "client") {
    super(
      (event, listener, impossible) => wire.observe(target, kind, "publish", event, value => {
        listener(trafficMessage(value))
      }, impossible),
      (listener, impossible) => wire.observe(target, kind, "publish", null, (event, value) => {
        if (typeof event === "string") listener(event, trafficMessage(value))
      }, impossible)
    )
  }

  public subscribeAsks(subscriber: AskSubscriber): Cleanup {
    return this.followAsks(subscriber)
  }

  public asks(options?: EventOptions) {
    return stream<AskCapture>((subscriber, impossible) => this.followAsks(subscriber, impossible), options)
  }

  private followAsks(subscriber: AskSubscriber, impossible?: (error: Error) => void): Cleanup {
    return wire.observe(this.target, this.kind, "ask", null, (event, questionId, message) => {
      if (typeof event !== "string" || typeof questionId !== "string") return
      subscriber({ event, questionId, message: trafficMessage(message) as AskCapture["message"] })
    }, impossible)
  }
}

export class ServerTrafficHandle extends TrafficHandle {
  public subscribeAnswers(subscriber: AnswerSubscriber): Cleanup {
    return this.followAnswers(subscriber)
  }

  public answers(options?: EventOptions) {
    return stream<AnswerCapture>((subscriber, impossible) => this.followAnswers(subscriber, impossible), options)
  }

  private followAnswers(subscriber: AnswerSubscriber, impossible?: (error: Error) => void): Cleanup {
    return wire.observe(this.target, "server", "answer", null, (event, questionId, message) => {
      if (typeof event !== "string" || typeof questionId !== "string") return

      const raw = message as { to?: EndpointReference, outcome?: Outcome }
      subscriber({
        event,
        questionId,
        message: { to: endpoint(raw.to), outcome: raw.outcome as Outcome }
      })
    }, impossible)
  }
}

class ServerHandle extends ServerBase {
  public readonly traffic: ServerTrafficHandle
  public readonly lifecycle: EndpointLifecycle

  public constructor(private readonly owner: ProcessHandle) {
    super()
    this.traffic = new ServerTrafficHandle(owner.address, "server")
    this.lifecycle = endpointLifecycle(owner.address, "server") as unknown as EndpointLifecycle
    bindEvents(this, endpointEvents(owner.address, "server"))
  }

  public async process() { return this.owner }

  public publish(event: string, payload: unknown = undefined) {
    wire.send("end-host", "send", this.owner.address, "server", event, payload)
  }

  public async exists() {
    const answer = await wire.request(["exists", "server", this.owner.address]) as [boolean]
    return answer[0]
  }

  public async start(launch: ServerLaunch = {}) { await wire.request(["start-endpoint", this.owner.address, "server", launch]) }
  public async stop() { await wire.request(["stop-endpoint", this.owner.address, "server"]) }
  public async isService() { return (await wire.request(["is-service", "server", this.owner.address]) as [boolean])[0] }

  public async waitReady(timeout?: number) {
    await wire.request(["wait-ready", this.owner.address, "server"], timeout)
  }

  public async ask<Answer = unknown>(event: string, payload: unknown = undefined) {
    return this.askWithin<Answer>(undefined, event, payload)
  }

  public timeout(milliseconds: number) {
    return { ask: <Answer = unknown>(event: string, payload: unknown = undefined) => this.askWithin<Answer>(milliseconds, event, payload) }
  }

  private async askWithin<Answer>(timeout: number | undefined, event: string, payload: unknown) {
    const deadline = new Deadline(timeout)
    await wire.requestWithin(["wait-ready", this.owner.address, "server", true], deadline)

    const identity = await wire.identity()
    const address = `server:${identity.process}:${randomUUID()}`
    const questionId = randomUUID()
    const waiting = wire.expectWithin(address, deadline)

    wire.send("end-host", "ask", this.owner.address, "server", address, questionId, event, payload)

    try { return await waiting as Answer }
    finally { wire.forget(address) }
  }
}

class ClientHandle extends ClientBase {
  public readonly traffic: TrafficHandle
  public readonly lifecycle: EndpointLifecycle
  public readonly window: Window

  public constructor(private readonly owner: ProcessHandle) {
    super()
    this.traffic = new TrafficHandle(owner.address, "client")
    this.lifecycle = endpointLifecycle(owner.address, "client") as unknown as EndpointLifecycle
    this.window = window(async () => owner.address)
    bindEvents(this, endpointEvents(owner.address, "client"))
  }

  public async process() { return this.owner }
  public publish(event: string, payload: unknown = undefined) { wire.send("end-host", "send", this.owner.address, "client", event, payload) }

  public async exists() {
    const answer = await wire.request(["exists", "client", this.owner.address]) as [boolean]
    return answer[0]
  }

  public async start(launch: ClientLaunch = {}) {
    await wire.request(["start-endpoint", this.owner.address, "client", launch])
  }

  public async stop() { await wire.request(["stop-endpoint", this.owner.address, "client"]) }
  public async isService() { return (await wire.request(["is-service", "client", this.owner.address]) as [boolean])[0] }
  public async waitReady(timeout?: number) { await wire.request(["wait-ready", this.owner.address, "client"], timeout) }

}

class WindowHandle extends Events {
  public constructor(private readonly target: WindowTarget) {
    super(...deferredScoped("host-end", target, (_event, values) => values[0]))
  }

  private async state() {
    const answer = await wire.request(["window", await this.target()]) as [WindowRecord]
    return answer[0]
  }

  public async title() { return (await this.state()).title }
  public async position() { return (await this.state()).position }
  public async size() { return (await this.state()).size }
  public async minimized() { return (await this.state()).minimized }
  public async front() { return (await this.state()).front }
  public async layer() { return (await this.state()).layer }
  public async location() { return (await this.state()).location }
  public async move(position: Position) { await wire.request(["move", await this.target(), position]) }
  public async resize(size: Size) { await wire.request(["resize", await this.target(), size]) }
  public async setGeometry(geometry: WindowGeometry) { await wire.request(["setGeometry", await this.target(), geometry]) }
  public async minimize(minimized = true) { await wire.request(["minimize", await this.target(), minimized]) }
  public async changeTitle(title: string) { await wire.request(["changeTitle", await this.target(), title]) }
  public async raise() { await wire.request(["raise", await this.target()]) }
}

type WindowTarget = () => Promise<HandleAddress>

type LifecycleTarget = HandleAddress | WindowTarget

function deferredScoped(route: string, target: WindowTarget, convert: (event: string, values: unknown[]) => unknown) {
  return [
    (event, listener, impossible) => {
      if (!windowEvent(event)) {
        impossible?.(new Error(`A Window has no "${event}" event`))
        return () => undefined
      }
      return deferred(target, subject => wire.on(route, event, (...values) => {
        const message = unscoped(subject, values)
        if (message) listener(convert(event, message))
      }, subject, impossible), impossible)
    },
    (listener, impossible) => deferred(target, subject => wire.onAll(route, (event, ...values) => {
      if (typeof event !== "string" || !windowEvent(event)) return
      const message = unscoped(subject, values)
      if (message) listener(event, convert(event, message))
    }, subject, impossible), impossible)
  ] as const satisfies ConstructorParameters<typeof Events>
}

function windowEvent(event: string) {
  return event === "move" || event === "resize" || event === "geometry" || event === "minimize" || event === "changeTitle" || event === "front"
}

function deferred(target: WindowTarget, register: (subject: string) => Cleanup, impossible?: (error: Error) => void): Cleanup {
  let active = true
  let stop: Cleanup = () => undefined

  void target().then(address => {
    if (active) stop = register(address.reference)
  }, error => {
    const failure = error instanceof Error ? error : new Error(String(error))
    if (active && impossible) impossible(failure)
    else if (active) queueMicrotask(() => { throw failure })
  })

  return () => {
    active = false
    stop()
  }
}

export function scoped(route: string, subject: string | null, convert: (event: string, values: unknown[]) => unknown) {
  return new Events(
    (event, listener, impossible) => wire.on(route, event, (...values) => {
      const message = unscoped(subject, values)
      if (message) listener(convert(event, message))
    }, subject, impossible),
    (listener, impossible) => wire.onAll(route, (event, ...values) => {
      if (typeof event !== "string") return
      const message = unscoped(subject, values)
      if (message) listener(event, convert(event, message))
    }, subject, impossible)
  )
}

/** Destinationless events originating from one Endpoint handle. */
export function endpointEvents(target: HandleAddress | null, half: "server" | "client") {
  return new Events(
    (event, listener, impossible) => wire.follow(target, half, event, listener, impossible),
    (listener, impossible) => wire.follow(target, half, null, (event, payload) => {
      if (typeof event === "string") listener(event, payload)
    }, impossible)
  )
}

/** Start and stop transitions belonging directly to one permanent Endpoint. */
export function endpointLifecycle(target: LifecycleTarget, half: "server" | "client") {
  return new Events(
    (event, listener, impossible) => resolved(target, subject => wire.on(
      "process-host",
      endpointLifecycleEvent(event),
      (...values) => {
        const message = unscoped(subject, values)
        if (message?.[1] === half) listener(undefined)
      },
      subject,
      impossible
    ), impossible),
    (listener, impossible) => resolved(target, subject => wire.onAll("process-host", (event, ...values) => {
      if (event !== "endpointStart" && event !== "endpointStop") return
      const message = unscoped(subject, values)
      if (message?.[1] === half) listener(event === "endpointStart" ? "start" : "stop", undefined)
    }, subject, impossible), impossible)
  )
}

function resolved(target: LifecycleTarget, register: (subject: string) => Cleanup, impossible?: (error: Error) => void) {
  return typeof target === "function" ? deferred(target, register, impossible) : register(target.reference)
}

function endpointLifecycleEvent(event: string) {
  if (event === "start") return "endpointStart"
  if (event === "stop") return "endpointStop"
  return event
}

function unscoped(subject: string | null, values: unknown[]) {
  if (subject === null) return values
  return values[0] === subject ? values.slice(1) : null
}

function programProcessEvent(event: string, values: unknown[]): unknown {
  if (event === "create") return process(values[0] as ProcessRecord)
  if (event === "exit") return { process: process(values[0] as ProcessRecord), ...exit(values[1], values[2]) }
  return undefined
}

function programEvent(event: string, values: unknown[]): unknown {
  if (event === "uninstall") return values[0] === true
  return undefined
}

function processEvent(event: string, values: unknown[]): unknown {
  if (event === "exit") return exit(values[0], values[1])
  return undefined
}

export function exit(code: unknown, signal: unknown): Exit {
  const namedSignal = stringOrNull(signal)
  return { status: namedSignal === null ? "exited" : "signaled", code: numberOrNull(code), signal: namedSignal }
}

function numberOrNull(value: unknown) { return typeof value === "number" ? value : null }
function stringOrNull(value: unknown) { return typeof value === "string" ? value : null }

export function trafficMessage(value: unknown): TrafficMessage {
  const raw = value as { to?: EndpointReference, payload?: unknown }
  return { to: endpoint(raw.to), payload: raw.payload }
}

export function bindEvents(target: object, events: Events) {
  Object.assign(target, {
    subscribe: events.subscribe.bind(events),
    waitFor: events.waitFor.bind(events),
    events: events.events.bind(events)
  })
}

export function program(record: ProgramRecord): Program {
  const handle = handles.obtain(`program:${record.reference}`, () => new ProgramHandle(record))
  handle.update(record)
  return handle as unknown as Program
}

export function process(record: ProcessRecord, endpoints: { server?: Server, client?: Client } = {}): Process {
  return handles.obtain(`process:${record.reference}`, () => new ProcessHandle(record, endpoints)) as unknown as Process
}

export function endpoint(reference: EndpointReference | undefined): Endpoint {
  if (!reference) throw new Error("The boundary returned an invalid Endpoint reference")
  const owner = process(reference.process) as unknown as ProcessHandle
  return reference.kind === "server" ? owner.server : owner.client
}

export function claimEndpoint(reference: string, kind: "server" | "client", endpoint: Endpoint) {
  return handles.adopt(`endpoint:${reference}:${kind}`, endpoint)
}

function endpointHandle(owner: ProcessHandle, kind: "server" | "client", preferred?: Endpoint) {
  return handles.obtain(`endpoint:${owner.reference}:${kind}`, () => preferred ?? (
    kind === "server" ? new ServerHandle(owner) : new ClientHandle(owner)
  ))
}

export function window(target: WindowTarget): Window {
  return new WindowHandle(target) as unknown as Window
}

/** Runtime constructor used to identify and type Server-visible Program handles. */
export const Program = CoreProgram

/** Runtime constructor used to identify and type Server-visible Process handles. */
export const Process = CoreProcess

/** Runtime constructor used to identify and type Server-visible Endpoint handles. */
export const Endpoint = CoreEndpoint

/** Runtime constructor used to identify and type Server-visible Server handles. */
export const Server = CoreServer

/** Runtime constructor used to identify and type Server-visible Client handles. */
export const Client = CoreClient
