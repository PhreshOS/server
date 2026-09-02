import type {
  Answerer as CoreAnswerer,
  ServerContext as CoreServerContext,
  ContextCapture as CoreContextCapture,
  ContextEvents as CoreContextEvents,
  ContextMessage as CoreContextMessage,
  EndpointLifecycle,
  ClientLaunch
} from "@phreshos/core"
import {
  ClientEndpoint,
  TrafficHandle,
  bindEvents,
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

/** The executing Process's canonical Client Endpoint handle. */
export type ContextClient<Events extends object = {}, Fallback = unknown> = ClientEndpoint<Events, Fallback>

/** One value addressed to the current Server Endpoint, with a server-visible sender. */
export type ContextMessage<Payload = unknown> = CoreContextMessage<Payload, Endpoint | null>

/** Applies the server-visible sender envelope to known Context events. */
export type ContextEvents<Events extends object> = CoreContextEvents<Events, Endpoint | null>

/** Every event observable through the current Server Endpoint Context. */
export type ContextCapture<Events extends object = {}> = CoreContextCapture<Events, Endpoint | null>

/** Handles one question addressed to the current Server Endpoint. */
export type Answerer<Payload = unknown, Result = undefined> = CoreAnswerer<Payload, Result>

/** Server runtime context: inbound communication, owner hierarchy, and paired Client Endpoint. */
export type Context<Events extends object = {}> = CoreServerContext<Events>

const ClientEndpointBase = ClientEndpoint as unknown as new () => object

class ContextClientHandle extends ClientEndpointBase {
  public readonly traffic = new TrafficHandle(null, "client") as unknown as ClientEndpoint["traffic"]
  public readonly lifecycle = endpointLifecycle(currentAddress, "client") as unknown as EndpointLifecycle
  public readonly window = window(currentAddress)

  public constructor(private readonly owner: () => Promise<Process>) {
    super()
    bindEvents(this, endpointEvents(null, "client"))
  }

  public process() { return this.owner() }
  public publish(event: string, payload: unknown = undefined) { wire.send("end-end", event, payload) }

  public async exists() {
    const answer = await wire.request(["exists", "client"]) as [boolean]
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

contextClient = new ContextClientHandle(owner) as unknown as ContextClient

class ServerContextHandle extends Events<ContextEvents<{}>, ContextMessage> implements Context {
  public readonly client = contextClient

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

  public async option(name: string) {
    const answer = await wire.request(["option", undefined, name]) as [string | undefined]
    return answer[0]
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
export const context: Context = new ServerContextHandle()
