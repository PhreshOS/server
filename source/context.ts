import type {
  Answerer as CoreAnswerer,
  ServerContext as CoreServerContext,
  ContextEvents as CoreContextEvents,
  ContextMessage as CoreContextMessage,
  EndpointLifecycle,
  ClientLaunch
} from "@phreshos/core"
import {
  ClientEndpoint,
  TrafficHandle,
  endpoint,
  endpointLifecycle,
  endpointEvents,
  process,
  program,
  window,
  type Process,
  type ProcessRecord,
  type ProgramRecord,
  type Endpoint,
  type EndpointReference
} from "./domain.js"
import Events from "./events.js"
import wire from "./wire.js"
import { programPermissions } from "./permissions.js"

/** The executing Process's canonical Client Endpoint handle. */
type ContextClient<Events extends object = {}, Fallback = unknown> = ClientEndpoint<Events, Fallback>

/** One value addressed to the current Server Endpoint, with a server-visible sender. */
type ContextMessage<Payload = unknown> = CoreContextMessage<Payload, Endpoint | null>

/** Applies the server-visible sender envelope to known Context events. */
type ContextEvents<Events extends object> = CoreContextEvents<Events, Endpoint | null>

/** Handles one question addressed to the current Server Endpoint. */
type Answerer<Payload = unknown, Result = undefined> = CoreAnswerer<Payload, Result>

/** Server runtime context: inbound communication, owner hierarchy, and paired Client Endpoint. */
type Context<Events extends object = {}> = CoreServerContext<Events>

class ContextClientHandle extends ClientEndpoint {
  public readonly subscribe: ClientEndpoint["subscribe"]
  public readonly wait: ClientEndpoint["wait"]
  public readonly events: ClientEndpoint["events"]
  public readonly traffic = new TrafficHandle(null, "client")
  public readonly lifecycle: EndpointLifecycle = endpointLifecycle(currentAddress, "client")
  public readonly window = window(currentAddress)

  public constructor(private readonly owner: () => Promise<Process>) {
    super()
    const events = endpointEvents(null, "client")
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public async process() { await this.running(); return this.owner() }
  public readonly publish: ClientEndpoint["publish"] = (event: string, payload: unknown = undefined) => {
    wire.send("end-end", event, payload)
  }

  public async running() {
    const answer = await wire.request(["running", "client"]) as [boolean]
    return answer[0]
  }

  public async start(launch: ClientLaunch = {}) {
    await wire.request(["start-endpoint", undefined, "client", launch])
  }

  public async stop() { await wire.request(["stop-endpoint", undefined, "client"]) }
  public async isService() { return (await wire.request(["is-service", "client"]) as [boolean])[0] }
  public async waitReady(timeout?: number) { await wire.request(["wait-ready", undefined, "client"], timeout) }
}

let ownerPromise: Promise<Process> | null = null
let contextClient!: ContextClient

function owner() {
  if (!ownerPromise) {
    const resolving = wire.request(["current-process"]).then(answer => {
      return process((answer as [ProcessRecord])[0], { client: contextClient })
    })

    const retained = resolving.catch(error => {
      if (ownerPromise === retained) ownerPromise = null
      throw error
    })

    ownerPromise = retained
  }

  return ownerPromise
}

contextClient = new ContextClientHandle(owner)

class ServerContextHandle extends Events<ContextEvents<{}>, ContextMessage> implements Context {
  public readonly client = contextClient
  public readonly permissions = programPermissions()

  public constructor() {
    super(
      (event, listener, impossible) => wire.on("end-end", event, value => listener(contextMessage(value)), null, impossible),
      (listener, impossible) => wire.onAll("end-end", (event, value) => {
        if (typeof event === "string") listener(event, contextMessage(value))
      }, null, impossible)
    )
  }

  public answer<Payload = unknown, Result = undefined>(event: string, answerer: Answerer<Payload, Result>) {
    return wire.answer("end-end", event, value => answerer(contextMessage(value) as ContextMessage<Payload>))
  }

  public process() { return owner() }

  public async name() { return (await owner()).name }

  public async parent() {
    const answer = await wire.request(["parent"]) as [ProcessRecord | null]
    return answer[0] ? process(answer[0]) : null
  }

  public async program() {
    const answer = await wire.request(["current-program"]) as [ProgramRecord]
    return program(answer[0])
  }

  public options<Options extends object = Readonly<Record<string, string>>>(): Promise<Readonly<Options>>
  public options<Option extends string = string>(name: string): Promise<Option | undefined>
  public async options(name?: string) {
    const process = await owner()
    return name === undefined ? process.options() : process.options(name)
  }

  public async stop() { await wire.request(["stop-current"]) }
  public async isService() { return (await wire.request(["is-service"]) as [boolean])[0] }
  public publish(event: string, payload: unknown = undefined) { wire.send("end-host", "emit", event, payload) }
}

async function currentAddress() {
  const identity = await wire.identity()
  return { identity: identity.process, reference: identity.reference }
}

function contextMessage(value: unknown): ContextMessage {
  const raw = value as { from?: EndpointReference | null, payload?: unknown }
  return { from: raw.from ? endpoint(raw.from) : null, payload: raw.payload }
}

/** Inbound events, owner hierarchy, and paired Client Endpoint for this Server runtime. */
export const context: CoreServerContext = new ServerContextHandle()
