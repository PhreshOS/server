import {
  parseSessionEndSnapshot,
  parseAuthenticationRequirements,
  parseAuthenticationState,
  parsePermissions,
  execute as executeRequest,
  type Connection,
  type ExecuteRequest,
  type ExecuteResult,
  type ServiceAddress,
  type System as CoreSystem,
  type AuthenticationCredentials,
  type SystemAuthentication,
  type SystemAuthenticationEvents,
  type SystemProcess as CoreSystemProcess,
  type SystemProcessEvents,
  type SystemProgram as CoreSystemProgram,
  type SystemProgramEvents,
  type SystemService,
  type SystemServiceEvents,
  type Session,
  type ProgramDefinition,
  type ShellOptions,
  type WritableAppearance
} from "@phreshos/core"
import type { ClientService, ServerService } from "./service.js"
import Events from "./events.js"
import {
  exit,
  process,
  program,
  type ProcessRecord,
  type ProgramRecord,
} from "./domain.js"
import { uploads } from "./uploads.js"
import ServerAppearance from "./appearance.js"
import wire from "./wire.js"
import { prepareService } from "./service.js"
import { systemStorage } from "./storage.js"
import shell from "./shell.js"
import network from "./network.js"
import { connection, session } from "./authentication.js"

class SystemHandle implements CoreSystem {
  public readonly storage = systemStorage()
  public readonly appearance: WritableAppearance = new ServerAppearance()
  public readonly program: CoreSystemProgram = new SystemProgramHandle()
  public readonly process: CoreSystemProcess = new SystemProcessHandle()
  public readonly authentication: SystemAuthentication = new SystemAuthenticationHandle()
  public readonly service: SystemService = new SystemServiceHandle()
  public readonly uploads = uploads
  public readonly network = network

  public execute<Request extends ExecuteRequest>(request: Request): Promise<ExecuteResult<Request>> {
    return executeRequest(this, request)
  }

  public async *shell(command: string, options: ShellOptions = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal, wire.signal]) : wire.signal
    yield* shell(command, { ...options, signal })
  }

}

class SystemServiceHandle extends Events<SystemServiceEvents, never> implements SystemService {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-service", event, (...values) => listener(prepareService(values[1] as ServiceAddress)), null, impossible),
      observer => wire.onAll("host-service", (event, ...values) => {
        if (typeof event === "string") observer(event, prepareService(values[1] as ServiceAddress))
      })
    )
  }

  public async list(): Promise<(ServerService | ClientService)[]> {
    const [addresses] = await wire.request(["host-service-list"]) as [ServiceAddress[]]
    return addresses.map(address => prepareService(address))
  }

  public async search(name: string): Promise<(ServerService | ClientService)[]> {
    const [addresses] = await wire.request(["host-service-search", name]) as [ServiceAddress[]]
    return addresses.map(address => prepareService(address))
  }

  public prepare<EventsMap extends object = {}, Fallback = unknown>(address: ServiceAddress<"server">): ServerService<EventsMap, Fallback>
  public prepare<EventsMap extends object = {}, Fallback = unknown>(address: ServiceAddress<"client">): ClientService<EventsMap, Fallback>
  public prepare(address: ServiceAddress): ServerService | ClientService
  public prepare(address: ServiceAddress) { return prepareService(address) }
}

class SystemProgramHandle extends Events<SystemProgramEvents, never> implements CoreSystemProgram {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-program", event, (...values) => listener(systemProgramEvent(event, values)), null, impossible),
      observer => wire.onAll("host-program", (event, ...values) => {
        if (typeof event === "string") observer(event, systemProgramEvent(event, values))
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

  public async create(source: ProgramDefinition | string) {
    const answer = await wire.request(["host-program-create", source]) as [ProgramRecord]
    return program(answer[0])
  }

  public async forceCreate(source: ProgramDefinition | string) {
    const answer = await wire.request(["host-program-force-create", source]) as [ProgramRecord]
    return program(answer[0])
  }
}

class SystemProcessHandle extends Events<SystemProcessEvents, never> implements CoreSystemProcess {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-process", event, (...values) => listener(systemProcessEvent(event, values)), null, impossible),
      observer => wire.onAll("host-process", (event, ...values) => {
        if (typeof event === "string") observer(event, systemProcessEvent(event, values))
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

class SystemAuthenticationHandle extends Events<SystemAuthenticationEvents, never> implements SystemAuthentication {
  public constructor() {
    super(
      (event, listener, impossible) => {
        const [route, sourceEvent] = authenticationEventRoute(event)
        return wire.on(route, sourceEvent, (...values) => listener(systemAuthenticationEvent(route, sourceEvent, values)), null, impossible)
      },
      (observer, impossible) => {
        const stops = (["host-connection", "host-session"] as const).map(route => wire.onAll(route, (event, ...values) => {
          if (typeof event !== "string") return
          const name = authenticationEventName(route, event)
          if (name) observer(name, systemAuthenticationEvent(route, event, values))
        }, null, impossible))
        return () => stops.forEach(stop => stop())
      }
    )
  }

  public async state() {
    const [value] = await wire.request(["host-authentication-state"]) as [unknown]
    return parseAuthenticationState(value)
  }

  public async requirements() {
    const [value] = await wire.request(["host-authentication-requirements"]) as [unknown]
    return parseAuthenticationRequirements(value)
  }

  public async connections(): Promise<Connection[]> {
    const [snapshots] = await wire.request(["host-authentication-connections"]) as [unknown[]]
    return snapshots.map(connection)
  }

  public async connection(identity: string): Promise<Connection | null> {
    const [snapshot] = await wire.request(["host-authentication-connection", identity]) as [unknown]
    return snapshot === null ? null : connection(snapshot)
  }

  public async sessions(): Promise<Session[]> {
    const [snapshots] = await wire.request(["host-authentication-sessions"]) as [unknown[]]
    return snapshots.map(session)
  }

  public async session(identity: string): Promise<Session | null> {
    const [snapshot] = await wire.request(["host-authentication-session", identity]) as [unknown]
    return snapshot === null ? null : session(snapshot)
  }

  public async setCredentials(credentials: AuthenticationCredentials) {
    await wire.request(["host-authentication-set-credentials", credentials])
  }

  public async signOutAllSessions() {
    await wire.request(["host-authentication-sign-out-all-sessions"])
  }
}

function systemProcessEvent(event: string, values: unknown[]): unknown {
  if (event === "create") {
    return process(values[1])
  }

  if (event === "exit") {
    return { process: process(values[1]), ...exit(values[2], values[3]) }
  }

  return values[0]
}

function systemProgramEvent(event: string, values: unknown[]): unknown {
  if (event === "create" || event === "forget" || event === "install") {
    return program(values[1])
  }

  if (event === "uninstall") {
    return { program: program(values[1]), purge: values[2] === true }
  }

  if (event === "pinned") {
    return { program: program(values[1]), pinned: values[2] === true }
  }

  if (event === "permissions") {
    const handle = program(values[1])
    return { program: handle, permissions: parsePermissions((values[1] as { permissions?: unknown }).permissions) }
  }

  return values[0]
}

function authenticationEventRoute(event: string): ["host-connection" | "host-session", string] {
  if (event === "connectionCreate") return ["host-connection", "create"]
  if (event === "connectionDisconnect") return ["host-connection", "disconnect"]
  if (event === "sessionCreate") return ["host-session", "create"]
  if (event === "sessionEnd") return ["host-session", "end"]
  throw new Error(`The Authentication domain does not expose a ${event} event`)
}

function authenticationEventName(route: "host-connection" | "host-session", event: string) {
  if (route === "host-connection" && event === "create") return "connectionCreate"
  if (route === "host-connection" && event === "disconnect") return "connectionDisconnect"
  if (route === "host-session" && event === "create") return "sessionCreate"
  if (route === "host-session" && event === "end") return "sessionEnd"
  return null
}

function systemAuthenticationEvent(route: "host-connection" | "host-session", event: string, values: unknown[]) {
  if (route === "host-connection") return connection(values[1])
  const handle = session(values[1])
  return event === "end" ? { session: handle, reason: parseSessionEndSnapshot({ ...(values[1] as object), reason: values[2] }).reason } : handle
}

/** Authoritative System capabilities for the currently executing Server Endpoint. */
export const system: CoreSystem = new SystemHandle()
