import assert from "node:assert/strict"
import { deserialize, serialize } from "@the-link/messagepack"
import { test } from "vitest"

test("process contract", async () => {
  const sent = []
  const originalSend = process.send

  process.send = message => { sent.push(message) }

  try {
    const [{ context }, { endpointLifecycle }] = await Promise.all([
      import("../dist/main.js"),
      import("../dist/domain.js")
    ])

    const name = context.name()
    const request = sent.map(deserialize).find(message => message[0] === "end-host" && message[1] === "wait" && message[3] === "current-process")

    assert.ok(request)

    const answer = serialize(["host-end", "answer", request[2], {
      success: true,
      result: [processRecord()]
    }])

    process.emit("message", Object.fromEntries([...answer].map((byte, index) => [index, byte])))

    assert.equal(await name, "process-main")

    const before = sent.length
    const stop = endpointLifecycle({ identity: "process-identity", reference: "process-reference" }, "client")
      .subscribe("stop", () => undefined)

    assert.equal(sent.length, before + 1)

    const subscription = deserialize(sent.at(-1))

    assert.ok(subscription)
    assert.equal(subscription[0], "boundary")
    assert.equal(subscription[1], "subscribe")
    assert.equal(subscription[3], "publish")
    assert.equal(subscription[4], "process-host")
    assert.equal(subscription[5], "endpointStop")
    assert.equal(subscription[6], "process-reference")

    stop()

    const unavailableBefore = sent.length
    const unavailable = endpointLifecycle({ identity: "missing", reference: "missing-reference" }, "server")
      .wait("start", 1_000)
    await new Promise(resolve => setImmediate(resolve))
    const unavailableValidation = sent.slice(unavailableBefore).map(deserialize)
      .find(message => message[0] === "end-host" && message[1] === "wait")

    assert.ok(unavailableValidation)

    const rejected = serialize(["host-end", "answer", unavailableValidation[2], {
      success: false,
      error: "The Endpoint handle does not exist"
    }])

    process.emit("message", Object.fromEntries([...rejected].map((byte, index) => [index, byte])))
    await assert.rejects(unavailable, /does not exist/)
  } finally {
    if (originalSend) process.send = originalSend
    else delete process.send
  }

  function processRecord() {
    return {
      reference: "process-reference",
      identity: "process-identity",
      name: "process-main",
      program: {
        reference: "program-reference",
        identity: "program",
        assetId: "program-assets",
        name: "Program",
        version: "0.0.0",
        description: null,
        hasAgent: false,
        server: { start: true, service: false },
        client: { sandbox: true, start: true, service: false, title: null, header: null, size: null, position: null, layer: null, minimize: null, maximize: null }
      },
      options: {},
      startedAt: new Date(0),
      server: { service: false },
      client: { service: false }
    }
  }
}, 120_000)
