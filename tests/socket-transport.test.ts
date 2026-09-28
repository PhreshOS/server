import { EventEmitter } from "node:events"
import { expect, test } from "vitest"
import { socketTransport } from "../source/wire"

/** A socket that records what is written to it. */
class RecordingSocket extends EventEmitter {
  readonly destroyed = false
  readonly writable = true
  readonly written: number[] = []
  write(frame: Uint8Array, done: (error?: Error | null) => void) {
    this.written.push(frame.byteLength)
    done()
    return true
  }
  destroy() {}
}

test("a message over the frame limit does not stop the messages after it", async () => {
  const socket = new RecordingSocket()
  const transport = socketTransport({ connect: () => socket as never }, "address", "token")
  socket.emit("connect")

  transport.send(new Uint8Array(17 * 1024 * 1024))
  transport.send(new Uint8Array(8))
  await new Promise(resolve => setTimeout(resolve, 20))

  // The token, then the small message; the oversized one never reaches the socket.
  expect(socket.written).toEqual([4 + "token".length, 4 + 8])
})
