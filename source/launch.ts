import { parseLaunch, type Launch, type ProgramLaunch } from "@phreshos/core"
import type { HandleAddress } from "./domain.js"
import wire from "./wire.js"

/** Bind saved launch operations to one Program handle. */
export default function launch(program: HandleAddress): ProgramLaunch {
  return {
    async get() {
      const [value] = await wire.request(["launch", program, "get"]) as [unknown]
      return value === null ? null : parseLaunch(value)
    },
    async set(value: Launch) {
      await wire.request(["launch", program, "set", parseLaunch(value)])
    }
  }
}
