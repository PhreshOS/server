import {
  parsePermission,
  parsePermissionChange,
  parsePermissions,
  type PermissionInput,
  type PermissionName,
  type ProgramPermissions
} from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Bind authoritative stored grants to one exact Program handle. */
export function programPermissions(program: HandleAddress): ProgramPermissions {
  const operate = <Name extends PermissionName>(operation: "all" | "get" | "set" | "delete", name?: Name, permission?: Exclude<PermissionInput<Name>, null>) => (
    wire.request(["program-permissions", program, operation, name, permission])
  )

  return {
    async get(name) { return parsePermission(name, (await operate("get", name) as [unknown])[0]) },
    async all() { return parsePermissions((await operate("all") as [unknown])[0]) },
    async set(name, permission) { return parsePermissionChange(name, (await operate("set", name, permission) as [unknown])[0]) },
    async delete(name) { return parsePermissionChange(name, (await operate("delete", name) as [unknown])[0]) }
  }
}
