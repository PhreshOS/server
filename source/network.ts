import type { Network } from "@phreshos/core"
import websocket from "./websocket.js"

/** Networking shares the lifetime of its owning System connection. */
export default function network(signal: () => AbortSignal): Network {
  return {
    async fetch(input, init) {
      const request = new Request(input, init)
      return fetch(request, { signal: AbortSignal.any([request.signal, signal()]) })
    },
    websocket(url, protocols) {
      return websocket(url, protocols, signal())
    }
  }
}
