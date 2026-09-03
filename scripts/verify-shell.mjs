import assert from "node:assert/strict"
import { fork } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { deserialize } from "@the-link/messagepack"

const directory = await mkdtemp(join(tmpdir(), "phresh-server-shell-"))
const entry = join(directory, "server.mjs")
const marker = join(directory, "closed.txt")
const sdk = pathToFileURL(resolve("dist/main.js")).href
const complete = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("process.stdout.write('local-shell')")}`
const longRunning = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setInterval(() => {}, 1_000)")}`

await writeFile(entry, `
import { writeFile } from "node:fs/promises"
import { system } from ${JSON.stringify(sdk)}

const output = []
for await (const event of system.shell(${JSON.stringify(complete)})) {
  if (event.event === "output") output.push(event.text)
}

const running = system.shell(${JSON.stringify(longRunning)})
const started = await running.next()
const waiting = running.next()
process.send?.({ localShell: output.join(""), pid: started.value.pid })

process.once("disconnect", async () => {
  try {
    await waiting
    await writeFile(${JSON.stringify(marker)}, "resolved")
  } catch (error) {
    await writeFile(${JSON.stringify(marker)}, error instanceof Error ? error.message : String(error))
  }
})
`)

const child = fork(entry, { stdio: ["ignore", "ignore", "ignore", "ipc"] })

try {
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The Server shell verification timed out")), 3_000)

    child.once("error", reject)
    child.on("message", message => {
      if (message instanceof Uint8Array || message && typeof message === "object" && !message.localShell) {
        const bytes = transportBytes(message)
        if (bytes) {
          const decoded = deserialize(bytes)
          if (decoded[0] === "end-host" && decoded[1] === "stream" && decoded[3] === "shell") {
            clearTimeout(timer)
            reject(new Error("Server system.shell crossed the Endpoint boundary"))
          }
        }
        return
      }

      if (message?.localShell === "local-shell" && Number.isInteger(message.pid)) {
        clearTimeout(timer)
        resolve(message)
      }
    })
  })

  assert.equal(result.localShell, "local-shell")
  child.disconnect()

  let closed = null
  const deadline = Date.now() + 3_000

  while (closed === null && Date.now() < deadline) {
    try { closed = await readFile(marker, "utf8") }
    catch { await new Promise(resolve => setTimeout(resolve, 20)) }
  }

  assert.match(closed ?? "", /System connection is closed/)
} finally {
  if (!child.killed) child.kill()
  await rm(directory, { recursive: true, force: true })
}

function transportBytes(value) {
  if (value instanceof Uint8Array) return value
  if (!value || typeof value !== "object") return null

  const bytes = new Uint8Array(Object.keys(value).length)
  for (let index = 0; index < bytes.length; index++) {
    if (typeof value[index] !== "number") return null
    bytes[index] = value[index]
  }
  return bytes
}
