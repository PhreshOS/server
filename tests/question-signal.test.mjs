import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"
import { deserialize, serialize } from "@the-link/messagepack"
import { test } from "vitest"

test("a question's signal aborts once its asker stops waiting, and only then", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phresh-server-signal-"))
  const entry = join(directory, "server.mjs")
  const sdk = pathToFileURL(resolve("dist/main.js")).href

  await writeFile(entry, `
  import { parentPort } from "node:worker_threads"

  const listeners = new Set()
  Object.defineProperty(globalThis, "__PHRESHOS_SERVER_TRANSPORT__", {
    value: Object.freeze({
      send: message => parentPort.postMessage(message),
      onMessage: listener => listeners.add(listener),
      onClose: listener => parentPort.once("close", listener)
    })
  })
  parentPort.on("message", message => { for (const listener of listeners) listener(message) })

  const { context } = await import(${JSON.stringify(sdk)})

  // Waits until its asker stops waiting, and says so.
  context.answer("slow", ({ signal }) => new Promise(resolve => signal.addEventListener("abort", () => {
    parentPort.postMessage({ aborted: signal.reason.message })
    resolve("late")
  })))
  // Answers at once; its signal never aborts.
  let quick
  context.answer("quick", ({ signal, payload }) => { quick = signal; return payload * 2 })
  parentPort.on("message", message => { if (message === "quick-aborted?") parentPort.postMessage({ quickAborted: quick.aborted }) })
  parentPort.postMessage({ registered: true })
  `)

  const worker = new Worker(entry)
  const received = []
  const waitFor = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for the worker")), 10_000)
    const check = () => { const found = received.find(predicate); if (found) { clearTimeout(timer); resolve(found) } else setTimeout(check, 10) }
    check()
  })
  worker.on("message", message => {
    if (message instanceof Uint8Array) received.push(deserialize(message))
    else received.push(message)
  })
  const send = (...values) => worker.postMessage(serialize(values))
  const question = (address, id, event, payload) => send("end-end", "wait", address, id, event, { from: null, payload })

  try {
    await waitFor(message => message?.registered)

    question("outside:quick", "q1", "quick", 21)
    const answer = await waitFor(message => Array.isArray(message) && message[1] === "answer" && message[2] === "outside:quick")
    assert.deepEqual(answer.at(-1), { success: true, result: 42 })

    question("outside:slow", "q2", "slow", null)
    await new Promise(resolve => setTimeout(resolve, 50))
    // The System tells the answering Server that the asker stopped waiting.
    send("boundary", "forget", "outside:slow")
    assert.deepEqual(await waitFor(message => message?.aborted), { aborted: "The asker stopped waiting" })

    // Forgetting a question already answered aborts nothing.
    send("boundary", "forget", "outside:quick")
    worker.postMessage("quick-aborted?")
    assert.deepEqual(await waitFor(message => "quickAborted" in (message ?? {})), { quickAborted: false })
  }
  finally {
    await worker.terminate()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
