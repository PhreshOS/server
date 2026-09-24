import {
  PermissionRequest as CorePermissionRequest,
  parsePermission,
  parsePermissionRequestSnapshot,
  type Permission,
  type PermissionRequestEvents,
  type PermissionRequestSnapshot,
  type SystemPermissionEvents,
  type SystemPermissions
} from "@phreshos/core"
import { endpoint } from "./domain.js"
import Events from "./events.js"
import wire from "./wire.js"

const handles = new Map<string, PermissionRequestHandle>()

class PermissionRequestHandle extends CorePermissionRequest {
  public readonly subscribe: CorePermissionRequest["subscribe"]
  public readonly wait: CorePermissionRequest["wait"]
  public readonly events: CorePermissionRequest["events"]
  public readonly identity: string
  public readonly from
  public readonly createdAt: Date
  public readonly expiresAt: Date
  public readonly name
  public readonly scope

  public constructor(snapshot: PermissionRequestSnapshot) {
    super()
    this.identity = snapshot.identity
    this.from = endpoint(snapshot.from)
    this.createdAt = snapshot.createdAt
    this.expiresAt = snapshot.expiresAt
    this.name = snapshot.name
    this.scope = snapshot.scope
    const events = new Events<PermissionRequestEvents, never>(
      (event, listener, impossible) => wire.on("permission-host", event, (...values) => {
        listener(parsePermission(this.name, values[2]))
      }, this.identity, impossible),
      (listener, impossible) => wire.onAll("permission-host", (event, ...values) => {
        if (event === "resolve") listener(event, parsePermission(this.name, values[2]))
      }, this.identity, impossible)
    )
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public async pending() {
    const answer = await wire.request(["permission-request-pending", this.identity]) as [unknown]
    return answer[0] === true
  }

  public async allow() { await wire.request(["permission-request-allow", this.identity]) }
  public async deny() { await wire.request(["permission-request-deny", this.identity]) }
  public async cancel() { await wire.request(["permission-request-cancel", this.identity]) }
}

function requestHandle(value: unknown) {
  const snapshot = parsePermissionRequestSnapshot(value)
  const current = handles.get(snapshot.identity)
  if (current) return current
  const created = new PermissionRequestHandle(snapshot)
  handles.set(snapshot.identity, created)
  return created
}

class PermissionRegistry extends Events<SystemPermissionEvents, never> implements SystemPermissions {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-permission", permissionEvent(event as keyof SystemPermissionEvents), (...values) => {
        listener(systemPermissionEvent(event as keyof SystemPermissionEvents, values))
      }, null, impossible),
      (listener, impossible) => wire.onAll("host-permission", (event, ...values) => {
        if (typeof event !== "string") return
        const name = publicPermissionEvent(event)
        if (name) listener(name, systemPermissionEvent(name, values))
      }, null, impossible)
    )
  }

  public async requests() {
    const [values] = await wire.request(["host-permission-requests"]) as [unknown[]]
    return values.map(requestHandle)
  }
}

function permissionEvent(event: keyof SystemPermissionEvents) {
  return event === "permissionRequest" ? "request" : "resolve"
}

function publicPermissionEvent(event: string): keyof SystemPermissionEvents | null {
  if (event === "request") return "permissionRequest"
  if (event === "resolve") return "permissionResolve"
  return null
}

function systemPermissionEvent(event: keyof SystemPermissionEvents, values: unknown[]) {
  const request = requestHandle(values[1])
  if (event === "permissionRequest") return request
  return { request, permission: parsePermission(request.name, values[2]) as Permission }
}

export const systemPermissions: SystemPermissions = new PermissionRegistry()
