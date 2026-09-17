import wire from "./wire.js"

/** A WebSocket whose network ownership remains inside the System boundary. */
export default async function websocket(url: string | URL, protocols?: string | string[]): Promise<WebSocket> {
  const identity = crypto.randomUUID()
  const socket = new RemoteWebSocket(identity, String(url))
  socket.listen()

  try {
    const [description] = await wire.request(["websocket-open", identity, String(url), protocols]) as [SocketDescription]
    socket.open(description)
    return socket as unknown as WebSocket
  } catch (error) {
    socket.fail()
    throw error
  }
}

class RemoteWebSocket extends EventTarget {
  public readonly CONNECTING = 0
  public readonly OPEN = 1
  public readonly CLOSING = 2
  public readonly CLOSED = 3
  public binaryType: BinaryType = "arraybuffer"
  public bufferedAmount = 0
  public extensions = ""
  public protocol = ""
  public readyState = this.CONNECTING
  public onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null
  public onerror: ((this: WebSocket, event: Event) => unknown) | null = null
  public onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null
  public onopen: ((this: WebSocket, event: Event) => unknown) | null = null

  private stopListening: (() => void) | null = null

  public constructor(private readonly identity: string, public readonly url: string) { super() }

  public listen() {
    this.stopListening = wire.on("host-websocket", this.identity, (type, value) => {
      if (type === "message") this.emit("message", { data: typeof value === "string" ? value : bytes(value) })
      else if (type === "error") this.emit("error")
      else if (type === "close") {
        this.readyState = this.CLOSED
        this.emit("close", value as object)
        this.stopListening?.()
        this.stopListening = null
      }
    })
  }

  public open(description: SocketDescription) {
    this.extensions = description.extensions
    this.protocol = description.protocol
    this.readyState = this.OPEN
    this.emit("open")
  }

  public fail() {
    this.readyState = this.CLOSED
    this.stopListening?.()
    this.stopListening = null
  }

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== this.OPEN) throw new Error("The WebSocket is not open")
    if (typeof Blob !== "undefined" && data instanceof Blob) throw new Error("Server WebSocket Blob messages are not supported; use bytes")
    wire.send("end-host", "websocket-send", this.identity, typeof data === "string" ? data : bytes(data))
  }

  public close(code?: number, reason?: string) {
    if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) return
    this.readyState = this.CLOSING
    wire.send("end-host", "websocket-close", this.identity, code, reason)
  }

  private emit(type: "open" | "message" | "error" | "close", fields: object = {}) {
    const event = new Event(type)
    for (const [name, value] of Object.entries(fields)) Object.defineProperty(event, name, { enumerable: true, value })
    this.dispatchEvent(event)
    const listener = this[`on${type}`]
    listener?.call(this as unknown as WebSocket, event as never)
  }
}

interface SocketDescription { extensions: string, protocol: string }

function bytes(value: unknown) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (Array.isArray(value)) return Uint8Array.from(value)
  throw new Error("A WebSocket message must be text or bytes")
}
