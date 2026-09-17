import type { Network } from "@phreshos/core"
import wire from "./wire.js"
import websocket from "./websocket.js"

/** Networking transported through the permission-constrained System boundary. */
class ServerNetwork implements Network {
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : null
    const [value] = await wire.request(["fetch", {
      body: body !== null,
      headers: [...request.headers.entries()],
      method: request.method,
      redirect: request.redirect,
      url: request.url
    }, body]) as [RemoteResponse]

    const response = new Response(value.body === null ? null : arrayBuffer(bytes(value.body)), {
      headers: value.headers,
      status: value.status,
      statusText: value.statusText
    })
    Object.defineProperties(response, {
      redirected: { configurable: true, enumerable: true, value: value.redirected },
      type: { configurable: true, enumerable: true, value: value.type },
      url: { configurable: true, enumerable: true, value: value.url }
    })
    return response
  }

  public websocket(url: string | URL, protocols?: string | string[]) { return websocket(url, protocols) }
}

interface RemoteResponse {
  body: Uint8Array | number[] | null
  headers: [string, string][]
  redirected: boolean
  status: number
  statusText: string
  type: ResponseType
  url: string
}

function bytes(value: Uint8Array | number[]) { return value instanceof Uint8Array ? value : Uint8Array.from(value) }

function arrayBuffer(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

export default new ServerNetwork()
