import assert from "node:assert/strict"
import { deserialize, serialize } from "../dist/messagepack.js"

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

  assert.equal(subscription[0], "boundary")
  assert.equal(subscription[1], "subscribe")
  assert.equal(subscription[3], "publish")
  assert.equal(subscription[4], "process-host")
  assert.equal(subscription[5], "endpointStop")
  assert.equal(subscription[6], "process-reference")

  stop()
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
      name: "Program",
      version: null,
      description: null,
      hasAgent: false,
      server: { start: true, service: false },
      client: { start: true, service: false, title: null, size: null, position: null, layer: null, minimize: null }
    },
    options: {},
    startedAt: new Date(0),
    server: { service: false },
    client: { service: false, window: { title: "Program", position: { x: 0, y: 0 }, size: { width: 600, height: 500 }, minimized: false, front: false, layer: "window", location: "/" } }
  }
}
