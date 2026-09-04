import {
  parsePermission,
  parsePermissions,
  type PermissionAssignments,
  type PermissionInput,
  type PermissionName,
  type ProcessPermissions,
  type ProgramPermissions
} from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Bind authoritative stored grants to one exact Program handle. */
export function programPermissions(program: HandleAddress): ProgramPermissions {
  return assignedPermissions("program-permissions", program)
}

/** Bind temporary grants to one exact Process handle. */
export function processPermissions(process: HandleAddress): ProcessPermissions {
  return assignedPermissions("process-permissions", process)
}

function assignedPermissions(word: "program-permissions" | "process-permissions", subject: HandleAddress): PermissionAssignments {
  const operate = <Name extends PermissionName>(operation: "all" | "get" | "allows" | "set" | "delete", name?: Name, permission?: PermissionInput<Name>) => (
    wire.request([word, subject, operation, name, permission])
  )

  return {
    async get(name) { return parsePermission(name, (await operate("get", name) as [unknown])[0]) },
    async all() { return parsePermissions((await operate("all") as [unknown])[0]) },
    async allows(name, permission = true) { return (await operate("allows", name, permission) as [unknown])[0] === true },
    async set(name, permission) { await operate("set", name, permission) },
    async delete(name) { await operate("delete", name) }
  }
}
