import type { Channel as CoreChannel, LaunchClient } from "@phreshos/core"
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
  type ProgramRecord
} from "./domain.js"
import wire from "./wire.js"

/** The current Process's canonical Client handle. */
export type CurrentClient<Events extends object = {}> = Client<Events>

/** Current Server context: its inbound Channel, owner hierarchy, and paired Client. */
export interface Current<Events extends object = {}> extends CoreChannel<Events> {
  /** The same Client handle exposed by the current Process. */
  readonly client: CurrentClient

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

  /** Stops the current Server; rejects when it is the final live Endpoint. */
  stop(): Promise<void>
}

const ClientBase = Client as unknown as new () => object

class CurrentClientHandle extends ClientBase {
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

}

let ownerPromise: Promise<Process> | null = null
let currentClient!: CurrentClient

function owner() {
  if (!ownerPromise) {
    const resolving = wire.request(["process"]).then(answer => {
      return process((answer as [ProcessRecord])[0], { client: currentClient })
    })

    const retained = resolving.catch(error => {
      if (ownerPromise === retained) ownerPromise = null
      throw error
    })

    ownerPromise = retained
  }

  return ownerPromise
}

currentClient = new CurrentClientHandle(owner) as unknown as CurrentClient

class ServerCurrent {
  public readonly client = currentClient

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
    const answer = await wire.request(["program"]) as [ProgramRecord]
    return program(answer[0])
  }

  public async option(name: string) {
    const answer = await wire.request(["option", undefined, name]) as [string | undefined]
    return answer[0]
  }

  public async stop() { await wire.request(["stop-current"]) }
}

function bindChannel(target: object, source: Channel) {
  Object.assign(target, {
    publish: source.publish.bind(source),
    subscribe: source.subscribe.bind(source),
    waitFor: source.waitFor.bind(source),
    events: source.events.bind(source),
    observe: source.observe.bind(source)
  })
}

/** Inbound events, owner hierarchy, and paired Client for the current Server. */
export const current = new ServerCurrent() as unknown as Current
