import type {
  DesktopWallpaper,
  Exit,
  FileWallpaper,
  Layer,
  Position,
  ServedFile,
  ClientServiceHandler,
  ServerServiceHandler,
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
import { service as serviceHandle } from "./service.js"

/** Resolved production description for a Program's Server. */
export type ServerDescription = Readonly<{
  /** Absolute directory containing the production Server files. */
  location: string

  /** Whether newly created Processes start this Server by default. */
  start?: boolean

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
export type HostProgramUninstall = Readonly<{
  /** Program that left the installed state. */
  program: Program

  /** Whether all installed resources, including storage, were removed. */
  everythingRemoved: boolean
}>

/** A Process exit reported with the Process that ended. */
export type HostProcessExit = Exit & Readonly<{
  /** Process that ended. */
  process: Process
}>

/** Authoritative lifecycle events visible to the Server host. */
export type HostEvents = {
  /** One Process Endpoint entered a new live incarnation. */
  endpointStart: Server | Client

  /** One Process Endpoint incarnation ended. */
  endpointStop: Server | Client

  /** A Program entered the runtime registry. */
  programCreate: Program

  /** A Program left the runtime registry. */
  programForget: Program

  /** A Program entered the installed state. */
  programInstall: Program

  /** A Program left the installed state. */
  programUninstall: HostProgramUninstall

  /** A Process entered the runtime set. */
  processCreate: Process

  /** A Process left the runtime set. */
  processExit: HostProcessExit
}

/** Authoritative system capabilities available to a Server endpoint. */
export interface Host<Events extends object = {}> extends Subscribable<HostEvents & Events, never> {
  /** Observable system Theme authority. */
  readonly theme: WritableTheme<ThemeProperties>

  /** Authoritative wallpaper visible before authentication. */
  readonly signInWallpaper: FileWallpaper

  /** Authoritative wallpaper visible within authenticated desktops. */
  readonly desktopWallpaper: DesktopWallpaper

  /** Publishes a value through the host and returns its public file metadata. */
  serve(value: unknown): Promise<ServedFile>

  /** Returns all known Programs, optionally restricted to installed Programs. */
  programs(onlyInstalled?: boolean): Promise<Program[]>

  /** Returns the Program with the given stable identity. */
  getProgram(identity: string): Promise<Program>

  /** Creates a runtime Program from a description or description file path. */
  createProgram(source: ProgramDescription | string): Promise<Program>

  /** Returns every live Process known to the authoritative host. */
  processes(): Promise<Process[]>

  /** Returns the live Process with the given runtime identity. */
  getProcess(identity: string): Promise<Process>

  /** Returns a stable handle for one exact Server service identity. */
  service<ServiceEvents extends object = {}>(key: {
    program: string
    endpoint: "server"
    name: string
  }): ServerServiceHandler<ServiceEvents>

  /** Returns a stable handle for one exact Client service identity. */
  service<ServiceEvents extends object = {}>(key: {
    program: string
    endpoint: "client"
    name: string
  }): ClientServiceHandler<ServiceEvents>
}

class ServerHost extends Events {
  public readonly theme = new ServerTheme()
  public readonly signInWallpaper = new ServerSignInWallpaper()
  public readonly desktopWallpaper = new ServerDesktopWallpaper()

  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-events", event, (...values) => listener(hostEvent(event, values)), null, impossible),
      observer => wire.onAll("host-events", (event, ...values) => {
        if (typeof event === "string") observer(event, hostEvent(event, values))
      })
    )
  }

  public serve(value: unknown) { return serve(value) }

  public async programs(onlyInstalled = false) {
    const answer = await wire.request(["programs", onlyInstalled]) as [ProgramRecord[]]
    return answer[0].map(program)
  }

  public async getProgram(identity: string) {
    const answer = await wire.request(["program", identity]) as [ProgramRecord]
    return program(answer[0])
  }

  public async createProgram(source: ProgramDescription | string) {
    const answer = await wire.request(["create-program", source]) as [ProgramRecord]
    return program(answer[0])
  }

  public async processes() {
    const answer = await wire.request(["processes"]) as [ProcessRecord[]]
    return answer[0].map(record => process(record))
  }

  public async getProcess(identity: string) {
    const answer = await wire.request(["process", identity]) as [ProcessRecord]
    return process(answer[0])
  }

  public service<ServiceEvents extends object = {}>(key: { program: string, endpoint: "server", name: string }): ServerServiceHandler<ServiceEvents>
  public service<ServiceEvents extends object = {}>(key: { program: string, endpoint: "client", name: string }): ClientServiceHandler<ServiceEvents>
  public service(key: { program: string, endpoint: "server" | "client", name: string }) {
    return serviceHandle(key)
  }
}

function hostEvent(event: string, values: unknown[]): unknown {
  if (event === "endpointStart" || event === "endpointStop") return lifecycleEndpoint(values[1], values[2])

  if (event === "processCreate") {
    return process(values[1] as ProcessRecord)
  }

  if (event === "processExit") {
    return { process: process(values[1] as ProcessRecord), ...exit(values[2], values[3]) }
  }

  if (event === "programCreate" || event === "programForget" || event === "programInstall") {
    return program(values[1] as ProgramRecord)
  }

  if (event === "programUninstall") {
    return { program: program(values[1] as ProgramRecord), everythingRemoved: values[2] === true }
  }

  return values[0]
}

/** Authoritative system capabilities for the currently executing Server. */
export const host = new ServerHost() as unknown as Host
