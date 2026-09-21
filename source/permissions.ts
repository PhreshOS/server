import {
  parsePermission,
  parsePermissions,
  type PermissionName,
  type ProgramPermissions,
  type PermissionRequest,
  type TimedProgramPermissions
} from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Bind authoritative permission state to one exact Program handle. */
export function programPermissions(program?: HandleAddress): ProgramPermissions {
  const operate = <Name extends PermissionName>(operation: "all" | "get" | "allows" | "allow" | "deny", name?: Name, permission?: PermissionRequest<Name>) => (
    wire.request(["program-permissions", program, operation, name, permission])
  )
  const timed = (timeout: number): TimedProgramPermissions => ({
    async request<Name extends PermissionName>(name: Name, permission: PermissionRequest<Name> = true) {
      const identity = crypto.randomUUID()
      const result = await wire.requestOrNull(["program-permissions", program, "request", identity, name, permission], timeout)
      return result === null ? null : parsePermission(name, (result as [unknown])[0])
    }
  })

  return {
    async get(name) { return parsePermission(name, (await operate("get", name) as [unknown])[0]) },
    async all() { return parsePermissions((await operate("all") as [unknown])[0]) },
    async allows(name, permission = true) { return (await operate("allows", name, permission) as [unknown])[0] === true },
    async allow(name, permission = true) { await operate("allow", name, permission) },
    async deny(name) { await operate("deny", name) },
    request: timed(defaultPermissionTimeout).request,
    timeout(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("A permission timeout must be a non-negative finite number")
      return timed(milliseconds)
    }
  }
}

export const defaultPermissionTimeout = 120_000
