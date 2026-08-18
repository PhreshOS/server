import type { PermissionDecisions, ProgramPermissions } from "@phreshos/core"
import wire from "./wire.js"

/** Creates the persistent permission manager for one Program handle. */
export default function permissions(program: unknown): ProgramPermissions {
  return {
    async get(name) {
      const answer = await wire.request(["permissions", program, "get", name]) as [boolean | undefined]
      return answer[0]
    },

    async getAll() {
      const answer = await wire.request(["permissions", program, "getAll"]) as [PermissionDecisions]
      return answer[0]
    },

    async set(name, value) {
      await wire.request(["permissions", program, "set", name, value])
    },

    async delete(name) {
      await wire.request(["permissions", program, "delete", name])
    }
  }
}
