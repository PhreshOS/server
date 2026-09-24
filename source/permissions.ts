import {
  parsePermission,
  parsePermissions,
  type ContextPermissions,
  type PermissionName,
  type ProgramPermissions,
  type PermissionRequestInput,
  type TimedContextPermissions
} from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Bind authoritative permission state to one exact Program handle. */
export function programPermissions(program?: HandleAddress): ProgramPermissions {
  const operate = <Name extends PermissionName>(operation: "all" | "get" | "allows" | "allow" | "deny", name?: Name, permission?: PermissionRequestInput<Name>) => (
    wire.request(["program-permissions", program, operation, name, permission])
  )

  return {
    async get(name) { return parsePermission(name, (await operate("get", name) as [unknown])[0]) },
    async all() { return parsePermissions((await operate("all") as [unknown])[0]) },
    async allows(name, permission = true) { return (await operate("allows", name, permission) as [unknown])[0] === true },
    async allow(name, permission = true) { await operate("allow", name, permission) },
    async deny(name) { await operate("deny", name) }
  }
}

/** Bind permission reads and requests to the currently executing Server Endpoint. */
export function contextPermissions(): ContextPermissions {
  const operate = <Name extends PermissionName>(operation: "all" | "get" | "allows", name?: Name, permission?: PermissionRequestInput<Name>) => (
    wire.request(["program-permissions", undefined, operation, name, permission])
  )
  const timed = (timeout?: number): TimedContextPermissions => ({
    async request<Name extends PermissionName>(name: Name, permission: PermissionRequestInput<Name> = true) {
      const identity = crypto.randomUUID()
      const request: unknown[] = ["context-permission-request", identity, name, permission]
      if (timeout !== undefined) request.push(timeout)
      const result = await wire.request(request)
      return parsePermission(name, (result as [unknown])[0])
    }
  })

  return {
    async get(name) { return parsePermission(name, (await operate("get", name) as [unknown])[0]) },
    async all() { return parsePermissions((await operate("all") as [unknown])[0]) },
    async allows(name, permission = true) { return (await operate("allows", name, permission) as [unknown])[0] === true },
    request: timed().request,
    timeout(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("A permission timeout must be a non-negative finite number")
      return timed(milliseconds)
    }
  }
}
