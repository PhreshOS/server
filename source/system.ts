import type {
  ServiceKey,
  System as CoreSystem,
  SystemProcess as CoreSystemProcess,
  SystemProgram as CoreSystemProgram,
  ProgramDefinition,
  WritableAppearance
} from "@phreshos/core"
import type { ClientService, ServerService } from "./service.js"
import Events from "./events.js"
import {
  exit,
  process,
  program,
  type Process,
  type ProcessRecord,
  type Program,
  type ProgramRecord,
} from "./domain.js"
import { uploads } from "./uploads.js"
import ServerAppearance from "./appearance.js"
import wire from "./wire.js"
import { prepareService } from "./service.js"
import { systemStorage } from "./storage.js"

export interface ServerSystemProgram extends Omit<CoreSystemProgram, "list" | "find" | "create"> {
  list(onlyInstalled?: boolean): Promise<Program[]>
  find(identity: string): Promise<Program | null>
  create(source: ProgramDefinition | string): Promise<Program>
}

export interface ServerSystemProcess extends Omit<CoreSystemProcess, "list" | "find"> {
  list(): Promise<Process[]>
  find(identity: string): Promise<Process | null>
}

/** Authoritative System contract refined with this SDK's Server-visible handles. */
export interface ServerSystem extends Omit<CoreSystem, "program" | "process" | "forceCreateProgram" | "service"> {
  readonly program: ServerSystemProgram
  readonly process: ServerSystemProcess

  forceCreateProgram(source: ProgramDefinition | string): Promise<Program>

  service<Events extends object = {}>(key: ServiceKey & { endpoint: "server" }): ServerService<Events>
  service<Events extends object = {}>(key: ServiceKey & { endpoint: "client" }): ClientService<Events>
}

class SystemHandle implements ServerSystem {
  public readonly storage = systemStorage()
  public readonly appearance = new ServerAppearance() as unknown as WritableAppearance
  public readonly program = new SystemProgramHandle() as unknown as ServerSystemProgram
  public readonly process = new SystemProcessHandle() as unknown as ServerSystemProcess
  public readonly uploads = uploads

  public async forceCreateProgram(source: ProgramDefinition | string) {
    const answer = await wire.request(["host-program-force-create", source]) as [ProgramRecord]
    return program(answer[0])
  }

  public service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "server" }): ServerService<ServiceEvents>
  public service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "client" }): ClientService<ServiceEvents>
  public service(key: ServiceKey) { return prepareService(key) }

}

class SystemProgramHandle extends Events {
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
}

class SystemProcessHandle extends Events {
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

function systemProcessEvent(event: string, values: unknown[]): unknown {
  if (event === "create") {
    return process(values[1] as ProcessRecord)
  }

  if (event === "exit") {
    return { process: process(values[1] as ProcessRecord), ...exit(values[2], values[3]) }
  }

  return values[0]
}

function systemProgramEvent(event: string, values: unknown[]): unknown {
  if (event === "create" || event === "forget" || event === "install") {
    return program(values[1] as ProgramRecord)
  }

  if (event === "uninstall") {
    return { program: program(values[1] as ProgramRecord), everything: values[2] === true }
  }

  return values[0]
}

/** Authoritative system capabilities for the currently executing Server. */
export const system: ServerSystem = new SystemHandle()
