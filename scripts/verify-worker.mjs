import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"
import { deserialize, serialize } from "../dist/messagepack.js"

const directory = await mkdtemp(join(tmpdir(), "phresh-server-worker-"))
const entry = join(directory, "server.mjs")
const sdk = pathToFileURL(resolve("dist/main.js")).href

await writeFile(entry, `
import { parentPort } from "node:worker_threads"
import { context } from ${JSON.stringify(sdk)}

const [value, name] = await Promise.all([
  context.option("worker-test"),
  context.name()
])
parentPort.postMessage({ verified: value, name })
`)

try {
  const worker = new Worker(entry)
  let ready = false

  const verified = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The worker Server SDK verification timed out")), 2_000)

    worker.on("error", reject)
    worker.on("message", message => {
      if (!(message instanceof Uint8Array)) {
        if (message?.verified === "worker-value" && message.name === "worker-main") {
          clearTimeout(timer)
          resolve(message)
        }
        return
      }

      const [route, ...values] = deserialize(message)

      if (route === "boundary" && values[0] === "ready") ready = true

      if (route === "end-host" && values[0] === "wait" && typeof values[1] === "string") {
        const result = values[2] === "current-process" ? [workerProcess()] : ["worker-value"]

        worker.postMessage(serialize(["end-host", "answer", values[1], { success: true, result }]))
      }
    })
  })

  assert.deepEqual(await verified, { verified: "worker-value", name: "worker-main" })
  assert.equal(ready, true)

  await worker.terminate()
} finally {
  await rm(directory, { recursive: true, force: true })
}

function workerProcess() {
  return {
    reference: "worker-process-reference",
    identity: "worker-process-identity",
    name: "worker-main",
    program: {
      reference: "worker-program-reference",
      identity: "worker-program",
      name: "Worker Program",
      version: null,
      description: null,
      hasAgent: false,
      server: { start: true },
      client: null
    },
    options: {},
    startedAt: new Date(0),
    server: {},
    client: null
  }
}
