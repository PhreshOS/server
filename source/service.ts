import {
  ClientService as CoreClientService,
  ServerService as CoreServerService,
  Service as CoreService,
  isServiceAddress,
  type ServiceLifecycleEvents,
  type ServiceLifecycle,
  type Subscribable,
  type ServiceAddress
} from "@phreshos/core"
import Deadline from "./deadline.js"
import Events from "./events.js"
import HandleRegistry from "./handle-registry.js"
import wire from "./wire.js"

const handles = new HandleRegistry()

/** Server SDK handle for a Service provided by a Server Endpoint. */
export abstract class ServerService<Events extends object = {}, Fallback = unknown> extends CoreServerService<Events, Fallback> {
  protected constructor() { super() }
}

/** Server SDK handle for a Service provided by a Client Endpoint. */
export abstract class ClientService<Events extends object = {}, Fallback = unknown> extends CoreClientService<Events, Fallback> {
  protected constructor() { super() }
}

class ServiceHandle {
  public readonly lifecycle: ServiceLifecycle

  public constructor(protected readonly serviceAddress: ServiceAddress) {
    this.lifecycle = new Events<ServiceLifecycleEvents, never>(...serviceEvents(serviceAddress, "lifecycle"))
  }

  public readonly publish = (event: string, payload: unknown = undefined) => {
    wire.send("end-host", "service-send", this.serviceAddress, event, payload)
  }

  public address() { return this.serviceAddress }

  public async available() {
    const answer = await wire.request(["service-available", this.serviceAddress]) as [boolean]
    return answer[0]
  }

  public async waitReady(timeout?: number) {
    await wire.request(["service-wait-ready", this.serviceAddress, timeout], timeout)
  }
}

class ServerHandler<EventsMap extends object = {}, Fallback = unknown> extends ServerService<EventsMap, Fallback> {
  public override readonly lifecycle: ServiceLifecycle
  public override readonly subscribe: Subscribable<EventsMap, Fallback>["subscribe"]
  public override readonly wait: Subscribable<EventsMap, Fallback>["wait"]
  public override readonly events: Subscribable<EventsMap, Fallback>["events"]
  private readonly service: ServiceHandle

  public constructor(private readonly serviceAddress: ServiceAddress<"server"> & Readonly<{ endpoint: "server" }>) {
    super()
    this.service = new ServiceHandle(serviceAddress)
    this.lifecycle = this.service.lifecycle
    const events = new Events<EventsMap, Fallback>(...serviceEvents(serviceAddress, "events"))
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public override readonly publish = (event: string, payload: unknown = undefined) => this.service.publish(event, payload)
  public override address() { return this.serviceAddress }
  public override available() { return this.service.available() }

  public override waitReady(timeout?: number) { return this.service.waitReady(timeout) }

  public override async ask<Answer = unknown>(event: string, payload: unknown = undefined) {
    return await this.askWithin<Answer>(new Deadline(), event, payload)
  }

  public override timeout(milliseconds: number) {
    return { ask: <Answer = unknown>(event: string, payload: unknown = undefined) => (
      this.askWithin<Answer>(new Deadline(milliseconds), event, payload)
    ) }
  }

  private async askWithin<Answer>(deadline: Deadline, event: string, payload: unknown) {
    const identity = await wire.identity()
    const address = `server:${identity.process}:${crypto.randomUUID()}`
    const question = crypto.randomUUID()
    const waiting = wire.expectWithin(address, deadline)

    wire.send("end-host", "service-ask", this.serviceAddress, address, question, event, payload)

    try { return await waiting as Answer }
    finally { wire.forget(address) }
  }
}

class ClientHandler<EventsMap extends object = {}, Fallback = unknown> extends ClientService<EventsMap, Fallback> {
  public override readonly lifecycle: ServiceLifecycle
  public override readonly subscribe: Subscribable<EventsMap, Fallback>["subscribe"]
  public override readonly wait: Subscribable<EventsMap, Fallback>["wait"]
  public override readonly events: Subscribable<EventsMap, Fallback>["events"]
  private readonly service: ServiceHandle

  public constructor(private readonly serviceAddress: ServiceAddress<"client"> & Readonly<{ endpoint: "client" }>) {
    super()
    this.service = new ServiceHandle(serviceAddress)
    this.lifecycle = this.service.lifecycle
    const events = new Events<EventsMap, Fallback>(...serviceEvents(serviceAddress, "events"))
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public override readonly publish = (event: string, payload: unknown = undefined) => this.service.publish(event, payload)
  public override address() { return this.serviceAddress }
  public override available() { return this.service.available() }
  public override waitReady(timeout?: number) { return this.service.waitReady(timeout) }
}

/** Whichever Endpoint holds a Service name, for what both kinds share. */
class AnyHandler<EventsMap extends object = {}, Fallback = unknown> extends CoreService<EventsMap, Fallback> {
  public override readonly lifecycle: ServiceLifecycle
  public override readonly subscribe: Subscribable<EventsMap, Fallback>["subscribe"]
  public override readonly wait: Subscribable<EventsMap, Fallback>["wait"]
  public override readonly events: Subscribable<EventsMap, Fallback>["events"]
  private readonly service: ServiceHandle

  public constructor(private readonly serviceAddress: ServiceAddress) {
    super()
    this.service = new ServiceHandle(serviceAddress)
    this.lifecycle = this.service.lifecycle
    const events = new Events<EventsMap, Fallback>(...serviceEvents(serviceAddress, "events"))
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public override readonly publish = (event: string, payload: unknown = undefined) => this.service.publish(event, payload)
  public override address() { return this.serviceAddress }
  public override available() { return this.service.available() }
  public override waitReady(timeout?: number) { return this.service.waitReady(timeout) }
}

/**
 * The handle to a Service name, the same one for the same address: the Server holding it, the Client
 * holding it, or whichever Endpoint holds it when no kind is named. It reaches the System only when used.
 */
export function serviceHandle(address: ServiceAddress): CoreService {
  if (!isServiceAddress(address)) throw new Error("A Service is reached by its name, such as file-picker-v1, and optionally the kind of Endpoint")

  const { name, endpoint } = address
  const key = `service:${name}:${endpoint ?? "any"}`

  if (endpoint === "server") return handles.obtain(key, () => new ServerHandler(Object.freeze({ name, endpoint })))
  if (endpoint === "client") return handles.obtain(key, () => new ClientHandler(Object.freeze({ name, endpoint })))
  return handles.obtain(key, () => new AnyHandler(Object.freeze({ name })))
}

function serviceEvents(address: ServiceAddress, scope: "lifecycle" | "events") {
  return [
    (event: string, listener: (message: unknown) => unknown) => wire.followService(address, scope, event, listener),
    (listener: (event: string, message: unknown) => unknown) => wire.followService(address, scope, null, (event, payload) => {
      if (typeof event === "string") listener(event, payload)
    })
  ] as const satisfies ConstructorParameters<typeof Events>
}
