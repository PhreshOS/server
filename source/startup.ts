import type { Launch, ProgramStartup, ProgramStartupEvents, Subscribable } from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Bind startup operations to one canonical Program handle. */
export default function startup(program: HandleAddress, changes: Subscribable<ProgramStartupEvents, never>): ProgramStartup {
  return {
    subscribe: changes.subscribe,
    wait: changes.wait,
    events: changes.events,

    async get() {
      const answer = await wire.request(["startup", program, "get"]) as [Launch | null]
      return answer[0]
    },

    async set(launch: Launch = {}) {
      await wire.request(["startup", program, "set", launch])
    },

    async remove() {
      await wire.request(["startup", program, "remove"])
    }
  }
}
