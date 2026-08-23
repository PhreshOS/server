import {
  ClientServiceHandler as CoreClientServiceHandler,
  ServerServiceHandler as CoreServerServiceHandler,
  isServiceKey,
  type ClientServiceChannel,
  type ClientServiceHandler,
  type ServerServiceChannel,
  type ServerServiceHandler,
  type ServiceHandler,
  type ServiceKey
} from "@phreshos/core"
import { randomUUID } from "node:crypto"
import Deadline from "./deadline.js"
import Events from "./events.js"
import HandleRegistry from "./handle-registry.js"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

const handles = new HandleRegistry()
const ServerServiceBase = CoreServerServiceHandler as unknown as new () => object
const ClientServiceBase = CoreClientServiceHandler as unknown as new () => object

class ServerChannelHandle extends Events {
  public constructor(private readonly key: ServiceKey) {
    super(...serviceEvents(key, "channel"))
  }

  public publish(event: string, payload: unknown = undefined) {
    wire.send("end-host", "service-send", this.key, event, payload)
  }

  public async ask<Answer = unknown>(event: string, payload: unknown = undefined) {
    return await this.askWithin<Answer>(new Deadline(), event, payload)
  }

  public timeout(milliseconds: number) {
    return {
      ask: <Answer = unknown>(event: string, payload: unknown = undefined) => {
        return this.askWithin<Answer>(new Deadline(milliseconds), event, payload)
      }
    }
  }

  private async askWithin<Answer>(deadline: Deadline, event: string, payload: unknown) {
    const identity = await wire.identity()
    const address = `server:${identity.process}:${randomUUID()}`
    const question = randomUUID()
    const waiting = wire.expectWithin(address, deadline)

    wire.send("end-host", "service-ask", this.key, address, question, event, payload)

    try { return await waiting as Answer }
    finally { wire.forget(address) }
  }
}

class ClientChannelHandle extends Events {
  public constructor(key: ServiceKey) {
    super(...serviceEvents(key, "channel"))
  }
}

class ServerHandler<EventsMap extends object = {}> extends ServerServiceBase {
  public readonly name: string
  public readonly channel: ServerServiceChannel<EventsMap>

  public constructor(private readonly key: ServiceKey & { endpoint: "server" }) {
    super()
    this.name = key.name
    this.channel = new ServerChannelHandle(key) as unknown as ServerServiceChannel<EventsMap>
    bindEvents(this, new Events(...serviceEvents(key, "lifecycle")))
  }

  public async enabled() {
    const answer = await wire.request(["service-enabled", this.key]) as [boolean]
    return answer[0]
  }

  public async waitReady(timeout?: number) {
    await wire.request(["service-wait-ready", this.key, timeout], timeout)
  }

}

class ClientHandler<EventsMap extends object = {}> extends ClientServiceBase {
  public readonly name: string
  public readonly channel: ClientServiceChannel<EventsMap>

  public constructor(private readonly key: ServiceKey & { endpoint: "client" }) {
    super()
    this.name = key.name
    this.channel = new ClientChannelHandle(key) as unknown as ClientServiceChannel<EventsMap>
    bindEvents(this, new Events(...serviceEvents(key, "lifecycle")))
  }

  public async enabled() {
    const answer = await wire.request(["service-enabled", this.key]) as [boolean]
    return answer[0]
  }

  public async waitReady(timeout?: number) {
    await wire.request(["service-wait-ready", this.key, timeout], timeout)
  }
}

export function prepareService<EventsMap extends object = {}>(key: ServiceKey & { endpoint: "server" }): ServerServiceHandler<EventsMap>
export function prepareService<EventsMap extends object = {}>(key: ServiceKey & { endpoint: "client" }): ClientServiceHandler<EventsMap>
export function prepareService(key: ServiceKey): ServiceHandler
export function prepareService(key: ServiceKey): ServiceHandler {
  if (!isServiceKey(key)) throw new Error("A complete service key is required")

  const normalized = Object.freeze({ program: key.program, endpoint: key.endpoint, name: key.name })
  const identity = JSON.stringify([normalized.program, normalized.endpoint, normalized.name])

  return handles.obtain(`service:${identity}`, () => {
    return normalized.endpoint === "server"
      ? new ServerHandler(normalized as ServiceKey & { endpoint: "server" })
      : new ClientHandler(normalized as ServiceKey & { endpoint: "client" })
  }) as unknown as ServiceHandler
}

export async function enableCurrentService(name: string) {
  await wire.request(["enable-service", name])
}

export async function disableCurrentService() {
  await wire.request(["disable-service"])
}

export async function endpointService<EventsMap extends object = {}>(target: HandleAddress | null, endpoint: "server"):
Promise<ServerServiceHandler<EventsMap> | null>
export async function endpointService<EventsMap extends object = {}>(target: HandleAddress | null, endpoint: "client"):
Promise<ClientServiceHandler<EventsMap> | null>
export async function endpointService(target: HandleAddress | null, endpoint: "server" | "client"):
Promise<ServiceHandler | null>
export async function endpointService(target: HandleAddress | null, endpoint: "server" | "client") {
  const answer = await wire.request(["endpoint-service", target, endpoint]) as [ServiceKey | null]
  return answer[0] ? prepareService(answer[0]) : null
}

function serviceEvents(key: ServiceKey, scope: "lifecycle" | "channel") {
  return [
    (event: string, listener: (message: unknown) => unknown) => wire.followService(key, scope, event, listener),
    (observer: (event: string, message: unknown) => unknown) => wire.followService(key, scope, null, (event, payload) => {
      if (typeof event === "string") observer(event, payload)
    })
  ] as const satisfies ConstructorParameters<typeof Events>
}

function bindEvents(target: object, events: Events) {
  Object.assign(target, {
    subscribe: events.subscribe.bind(events),
    waitFor: events.waitFor.bind(events),
    events: events.events.bind(events),
    observe: events.observe.bind(events)
  })
}
