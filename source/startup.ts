import type { Launch } from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Persistent Process creation settings used when the system starts. */
export interface ProgramStartup {
  /** Returns the configured startup launch, or `null` when disabled. */
  get(): Promise<Launch | null>

  /** Enables startup with one validated Process launch. */
  enable(launch?: Launch): Promise<void>

  /** Disables startup by removing the persisted Process launch. */
  disable(): Promise<void>
}

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
