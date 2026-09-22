import {
  parseSessionEndSnapshot,
  parsePermissions,
  execute as executeRequest,
  type Connection,
  type ExecuteRequest,
  type ExecuteResult,
  type ServiceAddress,
  type System as CoreSystem,
  type SystemConnection,
  type SystemConnectionEvents,
  type SystemProcess as CoreSystemProcess,
  type SystemProcessEvents,
  type SystemProgram as CoreSystemProgram,
  type SystemProgramEvents,
  type SystemSession,
  type SystemSessionEvents,
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
  public readonly connection: SystemConnection = new SystemConnectionHandle()
  public readonly session: SystemSession = new SystemSessionHandle()
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

class SystemConnectionHandle extends Events<SystemConnectionEvents, never> implements SystemConnection {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-connection", event, (...values) => listener(systemConnectionEvent(event, values)), null, impossible),
      observer => wire.onAll("host-connection", (event, ...values) => {
        if (typeof event === "string") observer(event, systemConnectionEvent(event, values))
      })
    )
  }

  public async list(): Promise<Connection[]> {
    const [snapshots] = await wire.request(["host-connection-list"]) as [unknown[]]
    return snapshots.map(connection)
  }

  public async find(identity: string): Promise<Connection | null> {
    const [snapshot] = await wire.request(["host-connection-find", identity]) as [unknown]
    return snapshot === null ? null : connection(snapshot)
  }
}

class SystemSessionHandle extends Events<SystemSessionEvents, never> implements SystemSession {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-session", event, (...values) => listener(systemSessionEvent(event, values)), null, impossible),
      observer => wire.onAll("host-session", (event, ...values) => {
        if (typeof event === "string") observer(event, systemSessionEvent(event, values))
      })
    )
  }

  public async list(): Promise<Session[]> {
    const [snapshots] = await wire.request(["host-session-list"]) as [unknown[]]
    return snapshots.map(session)
  }

  public async find(identity: string): Promise<Session | null> {
    const [snapshot] = await wire.request(["host-session-find", identity]) as [unknown]
    return snapshot === null ? null : session(snapshot)
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

function systemConnectionEvent(_event: string, values: unknown[]) {
  return connection(values[1])
}

function systemSessionEvent(event: string, values: unknown[]) {
  const handle = session(values[1])
  return event === "end" ? { session: handle, reason: parseSessionEndSnapshot({ ...(values[1] as object), reason: values[2] }).reason } : handle
}

/** Authoritative System capabilities for the currently executing Server Endpoint. */
export const system: CoreSystem = new SystemHandle()
