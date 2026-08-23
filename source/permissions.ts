import type { PermissionDecisions, ProgramPermission } from "@phreshos/core"
import wire from "./wire.js"

/** Creates the persistent permission manager for one Program handle. */
export default function permission(program: unknown): ProgramPermission {
  return {
    async get(name) {
      const answer = await wire.request(["program-permission", program, "get", name]) as [boolean | undefined]
      return answer[0]
    },

    async getAll() {
      const answer = await wire.request(["program-permission", program, "getAll"]) as [PermissionDecisions]
      return answer[0]
    },

    async set(name, value) {
      await wire.request(["program-permission", program, "set", name, value])
    },

    async delete(name) {
      await wire.request(["program-permission", program, "delete", name])
    }
  }
}
