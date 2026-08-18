import {
  Client as CoreClient,
  Endpoint as CoreEndpoint,
  Process as CoreProcess,
  Program as CoreProgram,
  Server as CoreServer,
  type AnswerCapture,
  type AskCapture,
  type Cleanup,
  type ClientDeclaration,
  type EndpointDeclaration,
  type Exit,
  type Launch,
  type LaunchClient,
  type Outcome,
  type Position,
  type ProgramIconSize,
  type ProgramPermissions,
  type ProgramArea as CoreProgramArea,
  type Size,
  type TrafficMessage,
  type Window as CoreWindow,
  type WindowSurfaceSettings,
  type WindowState
} from "@phreshos/core"
import { randomUUID } from "node:crypto"
import Events from "./events.js"
import Deadline from "./deadline.js"
import HandleRegistry from "./handle-registry.js"
import { area, sql, store, type ServerArea } from "./storage.js"
import startup, { type ProgramStartup } from "./startup.js"
import permissions from "./permissions.js"
import wire from "./wire.js"

export interface HandleAddress {
  identity: string
  reference: string
}

/** Server-side filesystem storage with access to its resolved host path. */
export interface ProgramArea extends CoreProgramArea {
  /** Returns the absolute host path of this storage area. */
  path(): Promise<string>

  /** Resolves path segments within this storage area without permitting escape. */
  resolve(...path: string[]): Promise<string>
}

/** Client-safe Program data transported by the authoritative host. */
export interface ProgramRecord {
  reference: string
  identity: string
  installed?: boolean
  name: string
  version: string | null
  description: string | null
  server: EndpointDeclaration | null
  client: ClientDeclaration | null
}

/** Process data transported with every Endpoint reference. */
export interface ProcessRecord {
  reference: string
  identity: string
  name: string | null
  program: ProgramRecord
  options: Record<string, string>
  startedAt: string | Date
  server: Record<string, never> | null
  client: Record<string, never> | null
}

export interface EndpointReference {
  kind: "server" | "client"
  process: ProcessRecord
}

export type WindowRecord = WindowState

/** Server-visible Program handle and privileged Program operations. */
export interface Program<Events extends object = {}> extends CoreProgram<Events> {
  /** Persistent filesystem data shared by every Process of this Program. */
  readonly data: ProgramArea

  /** Disposable filesystem data shared by every Process of this Program. */
  readonly cache: ProgramArea

  /** Persistent Process launch used when the system starts. */
  readonly startup: ProgramStartup

  /** Persistent permission decisions owned by this Program. */
  readonly permissions: ProgramPermissions

  /** Returns every live Process of this Program. */
  processes(): Promise<Process[]>

  /** Returns the earliest-started live Process, or `null` when none exist. */
  firstProcess(): Promise<Process | null>

  /** Returns the latest-started live Process, or `null` when none exist. */
  lastProcess(): Promise<Process | null>

  /** Finds a live Process by runtime identity or Program-local name. */
  getProcess(identityOrName: string): Promise<Process | null>

  /** Creates one Process of this Program. */
  createProcess(launch?: Launch): Promise<Process>

  /** Installs this Program and returns the same handle. */
  install(): Promise<this>

  /** Creates a new runtime Program with the supplied stable identity. */
  fork(identity: string): Promise<Program>
}

/** Server-visible Process handle. */
export interface Process<Events extends object = {}> extends CoreProcess<Events> {
  /** Permanent handle to this Process's Server. */
  readonly server: Server

  /** Permanent handle to this Process's Client. */
  readonly client: Client

  /** Returns the Program that owns this Process. */
  program(): Program

  /** Returns the parent Process, or `null` when this Process has none. */
  parent(): Promise<Process | null>
}

/** Server-visible common Endpoint handle. */
export interface Endpoint<Events extends object = {}> extends CoreEndpoint<Events> {
  /** Returns the Process that owns this Endpoint. */
  process(): Promise<Process>
}

/** Server-visible Server handle. */
export interface Server<Events extends object = {}> extends CoreServer<Events> {
  /** Returns the Process that owns this Server. */
  process(): Promise<Process>
}

/** Server-visible Client handle. */
export interface Client<Events extends object = {}> extends CoreClient<Events> {
  /** Presentation capability permanently owned by this Client handle. */
  readonly window: Window

  /** Returns the Process that owns this Client. */
  process(): Promise<Process>
}

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
  public readonly data: ServerArea
  public readonly cache: ServerArea
  public readonly store
  public readonly logs
  public readonly database
  public readonly startup
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
    this.permissions = permissions(this.address)

    bindEvents(this, scoped("host-end", record.reference, programEvent))
  }

  public get name() { return this.record.name }
  public get version() { return this.record.version }
  public get description() { return this.record.description }
  public get server() { return this.record.server }
  public get client() { return this.record.client }
  public get address(): HandleAddress { return { identity: this.identity, reference: this.reference } }

  public update(record: ProgramRecord) {
    if (record.reference !== this.reference) throw new Error("A Program handle cannot become another Program")
    this.record = record
  }

  public async processes() {
    const answer = await wire.request(["processes", this.address]) as [ProcessRecord[]]
    return answer[0].map(record => process(record))
  }

  public async firstProcess() {
    return chronological(await this.processes())[0] ?? null
  }

  public async lastProcess() {
    return chronological(await this.processes()).at(-1) ?? null
  }

  public async getProcess(identityOrName: string) {
    const answer = await wire.request(["program-process", this.address, identityOrName]) as [ProcessRecord | null]
    return answer[0] ? process(answer[0]) : null
  }

  public async createProcess(launch: Launch = {}) {
    const answer = await wire.request(["create-process", this.address, launch]) as [ProcessRecord]
    return process(answer[0])
  }

  public async apiDocs() {
    const answer = await wire.request(["api-docs", this.address]) as [string | null]
    return answer[0]
  }

  public async icon(size: ProgramIconSize = "medium") {
    const answer = await wire.request(["icon", this.address, size]) as [number[]]
    return new Blob([Uint8Array.from(answer[0])], { type: "image/png" })
  }

  public async installed() {
    const answer = await wire.request(["installed", this.address]) as [boolean]
    return answer[0]
  }

  public async install() {
    await wire.request(["install", this.address])
    return this
  }

  public async fork(identity: string) {
    const answer = await wire.request(["fork", this.address, identity]) as [ProgramRecord]
    return program(answer[0])
  }

  public async uninstall(everything = false) {
    await wire.request(["uninstall", this.address, everything])
  }

  public async forget() {
    await wire.request(["forget", this.address])
  }

  public async exitAll() {
    const answer = await wire.request(["exit-all", this.address]) as [string[]]
    return answer[0]
  }
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
      observer => wire.observe(target, kind, "publish", null, (event, value) => {
        if (typeof event === "string") observer(event, trafficMessage(value))
      })
    )
  }

  public observeAsks(observer: (capture: AskCapture) => unknown): Cleanup {
    return wire.observe(this.target, this.kind, "ask", null, (event, questionId, message) => {
      if (typeof event !== "string" || typeof questionId !== "string") return
      observer({ event, questionId, message: trafficMessage(message) as AskCapture["message"] })
    })
  }
}

export class ServerTrafficHandle extends TrafficHandle {
  public observeAnswers(observer: (capture: AnswerCapture) => unknown): Cleanup {
    return wire.observe(this.target, "server", "answer", null, (event, questionId, message) => {
      if (typeof event !== "string" || typeof questionId !== "string") return

      const raw = message as { to?: EndpointReference, outcome?: Outcome }
      observer({
        event,
        questionId,
        message: { to: endpoint(raw.to), outcome: raw.outcome as Outcome }
      })
    })
  }
}

class ServerHandle extends ServerBase {
  public readonly traffic: ServerTrafficHandle

  public constructor(private readonly owner: ProcessHandle) {
    super()
    this.traffic = new ServerTrafficHandle(owner.address, "server")
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

  public async start() { await wire.request(["start-endpoint", this.owner.address, "server"]) }
  public async stop() { await wire.request(["stop-endpoint", this.owner.address, "server"]) }

  public async waitReady(timeout?: number) {
    await wire.request(["wait-ready", this.owner.address], timeout)
  }

  public async ask<Answer = unknown>(event: string, payload: unknown = undefined) {
    return this.askWithin<Answer>(undefined, event, payload)
  }

  public timeout(milliseconds: number) {
    return { ask: <Answer = unknown>(event: string, payload: unknown = undefined) => this.askWithin<Answer>(milliseconds, event, payload) }
  }

  private async askWithin<Answer>(timeout: number | undefined, event: string, payload: unknown) {
    const deadline = new Deadline(timeout)
    await wire.requestWithin(["wait-ready", this.owner.address, true], deadline)

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
  public readonly window: Window

  public constructor(private readonly owner: ProcessHandle) {
    super()
    this.traffic = new TrafficHandle(owner.address, "client")
    this.window = window(async () => owner.address)
    bindEvents(this, endpointEvents(owner.address, "client"))
  }

  public async process() { return this.owner }
  public publish(event: string, payload: unknown = undefined) { wire.send("end-host", "send", this.owner.address, "client", event, payload) }

  public async exists() {
    const answer = await wire.request(["exists", "client", this.owner.address]) as [boolean]
    return answer[0]
  }

  public async start(overrides: LaunchClient = {}) {
    await wire.request(["start-endpoint", this.owner.address, "client", overrides])
  }

  public async stop() { await wire.request(["stop-endpoint", this.owner.address, "client"]) }

}

class WindowHandle extends Events {
  public readonly surface: WindowSurfaceHandle

  public constructor(private readonly target: WindowTarget) {
    super(...deferredScoped("host-end", target, (_event, values) => values[0]))
    this.surface = new WindowSurfaceHandle(target)
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
  public async minimize(minimized = true) { await wire.request(["minimize", await this.target(), minimized]) }
  public async changeTitle(title: string) { await wire.request(["changeTitle", await this.target(), title]) }
  public async raise() { await wire.request(["raise", await this.target()]) }
}

class WindowSurfaceHandle extends Events {
  public constructor(private readonly target: WindowTarget) {
    super(
      (event, listener, impossible) => {
        if (event !== "change") {
          impossible?.(new Error(`A Window Surface has no "${String(event)}" event`))
          return () => undefined
        }
        return deferred(target, subject => wire.on("host-end", "surface", (...values) => {
          const message = unscoped(subject, values)
          if (message) listener(message[0])
        }, subject, impossible), impossible)
      },
      observer => deferred(target, subject => wire.on("host-end", "surface", (...values) => {
        const message = unscoped(subject, values)
        if (message) observer("change", message[0])
      }, subject))
    )
  }

  public async snapshot() {
    const answer = await wire.request(["window", await this.target()]) as [WindowRecord]
    return answer[0].surface
  }

  public async set(settings: WindowSurfaceSettings = {}) { await wire.request(["surfaceSet", await this.target(), settings]) }
  public async remove() { await wire.request(["surfaceRemove", await this.target()]) }
}

type WindowTarget = () => Promise<HandleAddress>

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
    observer => deferred(target, subject => wire.onAll(route, (event, ...values) => {
      if (typeof event !== "string" || !windowEvent(event)) return
      const message = unscoped(subject, values)
      if (message) observer(event, convert(event, message))
    }, subject))
  ] as const satisfies ConstructorParameters<typeof Events>
}

function windowEvent(event: string) {
  return event === "move" || event === "resize" || event === "minimize" || event === "changeTitle" || event === "front"
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
    observer => wire.onAll(route, (event, ...values) => {
      if (typeof event !== "string") return
      const message = unscoped(subject, values)
      if (message) observer(event, convert(event, message))
    }, subject)
  )
}

/** Destinationless events originating from one Endpoint handle. */
export function endpointEvents(target: HandleAddress | null, half: "server" | "client") {
  return new Events(
    (event, listener, impossible) => wire.follow(target, half, event, listener, impossible),
    observer => wire.follow(target, half, null, (event, payload) => {
      if (typeof event === "string") observer(event, payload)
    })
  )
}

function unscoped(subject: string | null, values: unknown[]) {
  if (subject === null) return values
  return values[0] === subject ? values.slice(1) : null
}

function programEvent(event: string, values: unknown[]): unknown {
  if (event === "endpointStart" || event === "endpointStop") return lifecycleEndpoint(values[0], values[1])
  if (event === "processCreate") return process(values[0] as ProcessRecord)
  if (event === "processExit") return { process: process(values[0] as ProcessRecord), ...exit(values[1], values[2]) }
  if (event === "uninstall") return { everythingRemoved: values[0] === true }
  return undefined
}

function processEvent(event: string, values: unknown[]): unknown {
  if (event === "endpointStart" || event === "endpointStop") return lifecycleEndpoint(values[0], values[1])
  if (event === "exit") return exit(values[0], values[1])
  return undefined
}

export function lifecycleEndpoint(record: unknown, kind: unknown) {
  const owner = process(record as ProcessRecord)
  if (kind === "server") return owner.server
  if (kind === "client") return owner.client
  throw new Error("The host returned an invalid Endpoint lifecycle event")
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
    events: events.events.bind(events),
    observe: events.observe.bind(events)
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
