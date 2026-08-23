import type {
  DesktopWallpaper,
  Exit,
  FileWallpaper,
  Layer,
  Position,
  ServedFile,
  ClientServiceHandler,
  ServerServiceHandler,
  ServiceKey,
  Size,
  Subscribable,
  ThemeProperties,
  WritableTheme
} from "@phreshos/core"
import Events from "./events.js"
import {
  type Client,
  exit,
  lifecycleEndpoint,
  process,
  program,
  type Process,
  type ProcessRecord,
  type Program,
  type ProgramRecord,
  type Server
} from "./domain.js"
import serve from "./served.js"
import ServerTheme from "./theme.js"
import { ServerDesktopWallpaper, ServerSignInWallpaper } from "./wallpaper.js"
import wire from "./wire.js"
import { prepareService } from "./service.js"

/** Resolved production description for a Program's Server. */
export type ServerDescription = Readonly<{
  /** Absolute directory containing the production Server files. */
  location: string

  /** Whether newly created Processes start this Server by default. */
  start?: boolean

  /** Absolute Markdown file documenting the Service this Server may expose. */
  serviceDocs?: string

  /** Command used to install the Server's production dependencies. */
  installCommand?: string

  /** Command used to start the Server from its production directory. */
  startCommand: string
}>

/** Resolved production description for a Program's Client and initial Window. */
export type ClientDescription = Readonly<{
  /** Absolute directory containing the production Client files. */
  location: string

  /** Whether newly created Processes start this Client by default. */
  start?: boolean

  /** Absolute Markdown file documenting the Service this Client may expose. */
  serviceDocs?: string

  /** Default Window title. */
  title?: string

  /** Default Window size. */
  size?: Size

  /** Default Window position. */
  position?: Position

  /** Default Window layer. */
  layer?: Layer

  /** Whether the Window starts minimized. */
  minimize?: boolean
}>

type Description = Readonly<{
  /** Stable identity assigned to the Program. */
  identity: string

  /** Human-readable Program name. */
  name?: string

  /** Declared Program version. */
  version?: string

  /** Short human-readable Program description. */
  description?: string

  /** Absolute validated PNG source used to derive the Program's hosted icon sizes. */
  icon?: string

  /** Absolute directory used for the Program's persistent storage. */
  storage: string
}>

/** Complete runtime description used to create a Program. */
export type ProgramDescription = Description & (
  | Readonly<{
    /** Required Server description when no Client is described. */
    server: ServerDescription

    /** Optional Client description. */
    client?: ClientDescription
  }>
  | Readonly<{
    /** Optional Server description. */
    server?: ServerDescription

    /** Required Client description when no Server is described. */
    client: ClientDescription
  }>
)

/** An uninstall reported with the affected Program and removal scope. */
export type ProgramHostUninstall = Readonly<{
  /** Program that left the installed state. */
  program: Program

  /** Whether all installed resources, including storage, were removed. */
  everythingRemoved: boolean
}>

/** A Process exit reported with the Process that ended. */
export type ProcessHostExit = Exit & Readonly<{
  /** Process that ended. */
  process: Process
}>

/** Authoritative lifecycle events visible to the Server host. */
export type ProgramHostEvents = {
  /** A Program entered the runtime registry. */
  create: Program

  /** A Program left the runtime registry. */
  forget: Program

  /** A Program entered the installed state. */
  install: Program

  /** A Program left the installed state. */
  uninstall: ProgramHostUninstall
}

/** Authoritative Process lifecycle events visible to the Server host. */
export type ProcessHostEvents = {
  /** One Process Endpoint entered a new live incarnation. */
  endpointStart: Server | Client

  /** One Process Endpoint incarnation ended. */
  endpointStop: Server | Client

  /** A Process entered the runtime set. */
  create: Process

  /** A Process left the runtime set. */
  exit: ProcessHostExit
}

/** Authoritative Program registry available to a Server endpoint. */
export interface HostProgram extends Subscribable<ProgramHostEvents, never> {
  list(onlyInstalled?: boolean): Promise<Program[]>
  find(identity: string): Promise<Program | null>
  create(source: ProgramDescription | string): Promise<Program>
}

/** Authoritative Process registry available to a Server endpoint. */
export interface HostProcess extends Subscribable<ProcessHostEvents, never> {
  list(): Promise<Process[]>
  find(identity: string): Promise<Process | null>
}

/** Authoritative system capabilities available to a Server endpoint. */
export interface Host {
  /** Observable system Theme authority. */
  readonly theme: WritableTheme<ThemeProperties>

  /** Authoritative wallpaper visible before authentication. */
  readonly signInWallpaper: FileWallpaper

  /** Authoritative wallpaper visible within authenticated desktops. */
  readonly desktopWallpaper: DesktopWallpaper

  readonly program: HostProgram
  readonly process: HostProcess

  /** Returns a stable handle for one exact Service identity. */
  service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "server" }): ServerServiceHandler<ServiceEvents>
  service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "client" }): ClientServiceHandler<ServiceEvents>

  /** Publishes a value through the host and returns its public file metadata. */
  serve(value: unknown): Promise<ServedFile>

}

class ServerHost {
  public readonly theme = new ServerTheme()
  public readonly signInWallpaper = new ServerSignInWallpaper()
  public readonly desktopWallpaper = new ServerDesktopWallpaper()
  public readonly program = new ServerHostProgram() as unknown as HostProgram
  public readonly process = new ServerHostProcess() as unknown as HostProcess

  public service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "server" }): ServerServiceHandler<ServiceEvents>
  public service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "client" }): ClientServiceHandler<ServiceEvents>
  public service(key: ServiceKey) { return prepareService(key) }

  public serve(value: unknown) { return serve(value) }
}

class ServerHostProgram extends Events {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-program", event, (...values) => listener(hostProgramEvent(event, values)), null, impossible),
      observer => wire.onAll("host-program", (event, ...values) => {
        if (typeof event === "string") observer(event, hostProgramEvent(event, values))
      })
    )
  }

  public async list(onlyInstalled = false) {
    const answer = await wire.request(["host-program-list", onlyInstalled]) as [ProgramRecord[]]
    return answer[0].map(program)
  }

  public async find(identity: string) {
    const answer = await wire.request(["host-program-find", identity]) as [ProgramRecord | null]
    return answer[0] ? program(answer[0]) : null
  }

  public async create(source: ProgramDescription | string) {
    const answer = await wire.request(["host-program-create", source]) as [ProgramRecord]
    return program(answer[0])
  }
}

class ServerHostProcess extends Events {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-process", event, (...values) => listener(hostProcessEvent(event, values)), null, impossible),
      observer => wire.onAll("host-process", (event, ...values) => {
        if (typeof event === "string") observer(event, hostProcessEvent(event, values))
      })
    )
  }

  public async list() {
    const answer = await wire.request(["host-process-list"]) as [ProcessRecord[]]
    return answer[0].map(record => process(record))
  }

  public async find(identity: string) {
    const answer = await wire.request(["host-process-find", identity]) as [ProcessRecord | null]
    return answer[0] ? process(answer[0]) : null
  }
}

function hostProcessEvent(event: string, values: unknown[]): unknown {
  if (event === "endpointStart" || event === "endpointStop") return lifecycleEndpoint(values[1], values[2])

  if (event === "create") {
    return process(values[1] as ProcessRecord)
  }

  if (event === "exit") {
    return { process: process(values[1] as ProcessRecord), ...exit(values[2], values[3]) }
  }

  return values[0]
}

function hostProgramEvent(event: string, values: unknown[]): unknown {
  if (event === "create" || event === "forget" || event === "install") {
    return program(values[1] as ProgramRecord)
  }

  if (event === "uninstall") {
    return { program: program(values[1] as ProgramRecord), everythingRemoved: values[2] === true }
  }

  return values[0]
}

/** Authoritative system capabilities for the currently executing Server. */
export const host = new ServerHost() as unknown as Host
