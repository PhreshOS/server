import type { LaunchClient } from "@phreshos/core"
import { channel, type Answerer, type Channel } from "./channel.js"
import {
  Client,
  TrafficHandle,
  bindEvents,
  endpointEvents,
  process,
  program,
  window,
  type Process,
  type ProcessRecord,
  type Program,
  type ProgramRecord,
  type Server
} from "./domain.js"
import wire from "./wire.js"
import { endpointService } from "./service.js"

/** The executing Process's canonical Client handle. */
export type ContextClient<Events extends object = {}> = Client<Events>

/** Server runtime context: its inbound Channel, owner hierarchy, and paired Client. */
export interface Context<Events extends object = {}> extends Channel<Events>, Pick<Server, "service"> {
  /** The same Client handle exposed by the executing Process. */
  readonly client: ContextClient

  /** Registers one answerer; omitting its return produces `undefined`. */
  answer<Payload = unknown, Result = undefined>(event: string, answerer: Answerer<Payload, Result>): () => void

  /** Returns the Process represented by this Server. */
  process(): Promise<Process>

  /** Returns the parent Process, or `null` when this Process has none. */
  parent(): Promise<Process | null>

  /** Returns the Program that owns this Server. */
  program(): Promise<Program>

  /** Returns one immutable option supplied when this Process was created. */
  option(name: string): Promise<string | undefined>

  /** Stops the executing Server; rejects when it is the final live Endpoint. */
  stop(): Promise<void>

}

const ClientBase = Client as unknown as new () => object

class ContextClientHandle extends ClientBase {
  public readonly traffic = new TrafficHandle(null, "client") as unknown as Client["traffic"]
  public readonly window = window(async () => {
    const identity = await wire.identity()
    return { identity: identity.process, reference: identity.reference }
  })

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

  public async start(overrides: LaunchClient = {}) {
    await wire.request(["start-endpoint", undefined, "client", overrides])
  }

  public async stop() { await wire.request(["stop-endpoint", undefined, "client"]) }
  public service<ServiceEvents extends object = {}>() { return endpointService<ServiceEvents>(null, "client") }

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

class ServerContext {
  public readonly client = contextClient

  public constructor() {
    bindChannel(this, channel)
  }

  public answer<Payload = unknown, Result = undefined>(event: string, answerer: Answerer<Payload, Result>) {
    return channel.answer(event, answerer)
  }

  public process() { return owner() }

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
  public service<ServiceEvents extends object = {}>() { return endpointService<ServiceEvents>(null, "server") }
}

function bindChannel(target: object, source: Channel) {
  Object.assign(target, {
    publish: source.publish.bind(source),
    subscribe: source.subscribe.bind(source),
    waitFor: source.waitFor.bind(source),
    events: source.events.bind(source),
    observe: source.observe.bind(source),
    enableService: source.enableService.bind(source),
    disableService: source.disableService.bind(source)
  })
}

/** Inbound events, owner hierarchy, and paired Client for this Server runtime. */
export const context = new ServerContext() as unknown as Context
