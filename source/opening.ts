import {
  OpenRequest as CoreOpenRequest,
  parseOpenRequestSnapshot,
  parseOpeningDefaults,
  type OpenRequestEvents,
  type OpenRequestSnapshot,
  type Program,
  type SystemOpening,
  type SystemOpeningEvents
} from "@phreshos/core"
import { endpoint, program as programHandle } from "./domain.js"
import Events from "./events.js"
import wire from "./wire.js"

const handles = new Map<string, OpenRequestHandle>()

class OpenRequestHandle extends CoreOpenRequest {
  public readonly subscribe: CoreOpenRequest["subscribe"]
  public readonly wait: CoreOpenRequest["wait"]
  public readonly events: CoreOpenRequest["events"]
  public readonly identity: string
  public readonly from
  public readonly createdAt: Date
  public readonly target
  public readonly programs

  public constructor(snapshot: OpenRequestSnapshot) {
    super()
    this.identity = snapshot.identity
    this.from = snapshot.from ? endpoint(snapshot.from) : null
    this.createdAt = snapshot.createdAt
    this.target = snapshot.target
    this.programs = snapshot.programs.map(programHandle)
    const events = new Events<OpenRequestEvents, never>(
      (_event, listener, impossible) => wire.on("host-opening", "resolve", (...values) => {
        if (openRequestIdentity(values[1]) === this.identity) listener(chosenProgram(values[2]))
      }, null, impossible),
      (listener, impossible) => wire.onAll("host-opening", (event, ...values) => {
        if (event === "resolve" && openRequestIdentity(values[1]) === this.identity) listener("resolve", chosenProgram(values[2]))
      }, null, impossible)
    )
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public async pending() {
    const answer = await wire.request(["opening-request-pending", this.identity]) as [unknown]
    return answer[0] === true
  }

  public async choose(program: Program, options: Readonly<{ always?: boolean }> = {}) {
    await wire.request(["opening-request-choose", this.identity, program.identity, options])
  }

  public async cancel() { await wire.request(["opening-request-cancel", this.identity]) }
}

function openRequestIdentity(value: unknown) {
  return value && typeof value === "object" ? (value as { identity?: unknown }).identity : undefined
}

/** The Program a request was opened with, or `null` when it ended without one. */
function chosenProgram(value: unknown) {
  return value === null || value === undefined ? null : programHandle(value)
}

function requestHandle(value: unknown) {
  const snapshot = parseOpenRequestSnapshot(value)
  const current = handles.get(snapshot.identity)
  if (current) return current
  const created = new OpenRequestHandle(snapshot)
  handles.set(snapshot.identity, created)
  return created
}

class OpeningRegistry extends Events<SystemOpeningEvents, never> implements SystemOpening {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-opening", event === "openRequest" ? "request" : "resolve", (...values) => {
        listener(openingEvent(event as keyof SystemOpeningEvents, values))
      }, null, impossible),
      (listener, impossible) => wire.onAll("host-opening", (event, ...values) => {
        if (event === "request") listener("openRequest", openingEvent("openRequest", values))
        if (event === "resolve") listener("openResolve", openingEvent("openResolve", values))
      }, null, impossible)
    )
  }

  public async requests() {
    const [values] = await wire.request(["host-opening-requests"]) as [unknown[]]
    return values.map(requestHandle)
  }

  public async defaults() {
    const [defaults] = await wire.request(["host-opening-defaults"]) as [unknown]
    return Object.freeze(Object.fromEntries(Object.entries(parseOpeningDefaults(defaults)).map(([type, program]) => [type, programHandle(program)])))
  }

  public async setDefault(type: string, program: Program) {
    await wire.request(["host-opening-set-default", type, program.identity])
  }

  public async clearDefault(type: string) {
    await wire.request(["host-opening-clear-default", type])
  }
}

function openingEvent(event: keyof SystemOpeningEvents, values: unknown[]) {
  const request = requestHandle(values[1])
  if (event === "openRequest") return request
  return { request, program: chosenProgram(values[2]) }
}

export const systemOpening: SystemOpening = new OpeningRegistry()
