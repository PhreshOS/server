import type { ClientMemory, HandleAddress, JsonValue } from "@phreshos/core"
import wire from "./wire.js"

type Snapshot = { run: string, revision: number, value: JsonValue | undefined }
type CompareResult = { changed: boolean, snapshot: Snapshot }

/** Transport of one System-owned Client run memory, including atomic updates. */
export default function clientMemory(target: HandleAddress | null): ClientMemory {
  const snapshots = new Map<string, Snapshot>()
  const address = () => target ? Promise.resolve(target) : wire.identity().then(({ process, reference }) => ({ identity: process, reference }))
  const ask = async (operation: string, key?: string, value?: unknown, expected?: Snapshot) => {
    const [result] = await wire.request(["client-memory", await address(), operation, key, value, expected]) as [unknown]
    return result
  }
  return {
    async get<Value extends JsonValue = JsonValue>(key: string) { const snapshot = await ask("snapshot", key) as Snapshot; snapshots.set(key, snapshot); return snapshot.value as Value | undefined },
    async set(key, value) { snapshots.set(key, await ask("set", key, value) as Snapshot) },
    async update<Value extends JsonValue>(key: string, updater: (current: Value | undefined) => Value) {
      let snapshot = snapshots.get(key) ?? await ask("snapshot", key) as Snapshot
      for (;;) {
        const next = updater(snapshot.value as Value | undefined)
        const result = await ask("compareAndSet", key, next, snapshot) as CompareResult
        snapshots.set(key, result.snapshot)
        if (result.changed) return result.snapshot.value as Value
        if (result.snapshot.run !== snapshot.run) throw new Error("The Client run changed during the update")
        snapshot = result.snapshot
      }
    },
    async delete(key) { const deleted = await ask("delete", key) as boolean; snapshots.delete(key); return deleted },
    async entries() { return await ask("entries") as readonly (readonly [string, JsonValue])[] },
    subscribe<Value extends JsonValue = JsonValue>(key: string, subscriber: (value: Value | undefined) => unknown) {
      let active = true
      let stop: (() => void) | undefined
      let latest: Snapshot | undefined
      const deliver = (snapshot: Snapshot) => {
        if (!active || (latest && (latest.run !== snapshot.run || latest.revision > snapshot.revision))) return
        latest = snapshot
        snapshots.set(key, snapshot)
        subscriber(snapshot.value as Value | undefined)
      }
      void address().then(value => {
        if (!active) return
        stop = wire.on("host-client-memory", key, (reference, snapshot) => {
          if ((reference as { reference?: string })?.reference !== value.reference) return
          deliver(snapshot as Snapshot)
        }, value.reference)
        void ask("snapshot", key).then(snapshot => deliver(snapshot as Snapshot)).catch(() => undefined)
      }).catch(() => undefined)
      return () => { active = false; stop?.() }
    }
  }
}
