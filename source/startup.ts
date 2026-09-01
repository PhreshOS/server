import type { Launch, SystemProgramStartup } from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Persistent Process creation settings used when the system starts. */
export type ProgramStartup = SystemProgramStartup

/** Bind startup operations to one canonical Program handle. */
export default function startup(program: HandleAddress): ProgramStartup {
  return {
    async get() {
      const answer = await wire.request(["startup", program, "get"]) as [Launch | null]
      return answer[0]
    },

    async enable(launch: Launch = {}) {
      await wire.request(["startup", program, "enable", launch])
    },

    async disable() {
      await wire.request(["startup", program, "disable"])
    }
  }
}
