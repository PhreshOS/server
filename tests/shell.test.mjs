import assert from "node:assert/strict"
import { fork } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { deserialize, serialize } from "@the-link/messagepack"
import { test } from "vitest"

test("shell operations cross the System boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-server-shell-"))
  const entry = join(directory, "server.mjs")
  const sdk = pathToFileURL(resolve("dist/main.js")).href

  await writeFile(entry, `
  import { system } from ${JSON.stringify(sdk)}

  const events = []
  for await (const event of system.shell("example command", { cwd: "/example" })) events.push(event)
  process.send?.({ events })
  `)

  const child = fork(entry, { stdio: ["ignore", "ignore", "ignore", "ipc"] })
  let request = null

  try {
    const events = await new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => reject(new Error("The Server shell verification timed out")), 3_000)

      child.once("error", reject)
      child.on("message", message => {
        if (message?.events) {
          clearTimeout(timer)
          resolveResult(message.events)
          return
        }

        const bytes = transportBytes(message)
        if (!bytes) return
        const decoded = deserialize(bytes)
        if (decoded[0] !== "end-host" || decoded[1] !== "stream" || decoded[3] !== "shell") return

        request = decoded
        const question = decoded[2]
        child.send(serialize(["host-end", "stream", question, "open"]))
        child.send(serialize(["host-end", "stream", question, "data", { event: "started", pid: 42 }]))
        child.send(serialize(["host-end", "stream", question, "data", { event: "output", stream: "stdout", text: "from System" }]))
        child.send(serialize(["host-end", "stream", question, "data", { event: "exited", exit: { code: 0, signal: null } }]))
        child.send(serialize(["host-end", "stream", question, "answer", { success: true }]))
      })
    })

    assert.deepEqual(request?.slice(3), ["shell", "example command", { cwd: "/example" }])
    assert.deepEqual(events, [
      { event: "started", pid: 42 },
      { event: "output", stream: "stdout", text: "from System" },
      { event: "exited", exit: { code: 0, signal: null } }
    ])
  } finally {
    if (!child.killed) child.kill()
    await rm(directory, { recursive: true, force: true })
  }
})

function transportBytes(value) {
  if (value instanceof Uint8Array) return value
  if (!value || typeof value !== "object" || "events" in value) return null

  const bytes = new Uint8Array(Object.keys(value).length)
  for (let index = 0; index < bytes.length; index++) {
    if (typeof value[index] !== "number") return null
    bytes[index] = value[index]
  }
  return bytes
}
