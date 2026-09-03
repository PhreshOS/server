/** Open a native WebSocket owned by one Server Endpoint lifetime. */
export default async function websocket(
  url: string | URL,
  protocols: string | string[] | undefined,
  signal: AbortSignal
): Promise<WebSocket> {
  if (signal.aborted) throw signal.reason

  const socket = protocols === undefined
    ? new WebSocket(url)
    : new WebSocket(url, protocols)

  const close = () => socket.close()
  const release = () => signal.removeEventListener("abort", close)

  signal.addEventListener("abort", close, { once: true })
  socket.addEventListener("close", release, { once: true })

  if (signal.aborted) close()

  return socket
}
