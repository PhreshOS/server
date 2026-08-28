import type {
  ServiceKey,
  System,
  SystemProcess,
  SystemProgram,
  ProgramDescription,
  WritableAppearance
} from "@phreshos/core"
import type { ClientServiceHandler, ServerServiceHandler } from "./service.js"
import Events from "./events.js"
import {
  exit,
  lifecycleEndpoint,
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

class ServerSystem {
  public readonly storage = systemStorage()
  public readonly appearance = new ServerAppearance() as unknown as WritableAppearance
  public readonly program = new ServerSystemProgram() as unknown as SystemProgram
  public readonly process = new ServerSystemProcess() as unknown as SystemProcess
  public readonly uploads = uploads

  public service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "server" }): ServerServiceHandler<ServiceEvents>
  public service<ServiceEvents extends object = {}>(key: ServiceKey & { endpoint: "client" }): ClientServiceHandler<ServiceEvents>
  public service(key: ServiceKey) { return prepareService(key) }

}

class ServerSystemProgram extends Events {
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

  public async create(source: ProgramDescription | string) {
    const answer = await wire.request(["host-program-create", source]) as [ProgramRecord]
    return program(answer[0])
  }
}

class ServerSystemProcess extends Events {
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
  if (event === "endpointStart" || event === "endpointStop") return lifecycleEndpoint(values[1], values[2])

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
    return { program: program(values[1] as ProgramRecord), everythingRemoved: values[2] === true }
  }

  return values[0]
}

/** Authoritative system capabilities for the currently executing Server. */
export const system = new ServerSystem() as unknown as System
