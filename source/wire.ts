import { randomUUID } from "node:crypto"
import type { Cleanup, Outcome, ServiceKey } from "@phreshos/core"
import Deadline from "./deadline.js"
import { defaultTimeout } from "./events.js"
import type { HandleAddress } from "./domain.js"
import { deserialize, serialize } from "./messagepack.js"
import { parentPort } from "node:worker_threads"

type Handler = (...values: unknown[]) => unknown
type Failure = (error: Error) => void
type TrafficKind = "publish" | "ask" | "answer"

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface PendingStream {
  queue: unknown[]
  opened: boolean
  ended: boolean
  failure: Error | null
  wake: (() => void) | null
  timer: ReturnType<typeof setTimeout>
}

interface Question {
  address: string
  id: string
}

/** The server endpoint's sole IPC adapter. */
class Wire {
  private readonly lifetime = new AbortController()
  private readonly pending = new Map<string, Pending>()
  private readonly streams = new Map<string, PendingStream>()
  private readonly subscribers = new Map<string, Set<Handler>>()
  private readonly every = new Map<string, Set<Handler>>()
  private readonly answerers = new Map<string, Handler>()
  private readonly waiting = new Map<string, { values: unknown[], question: Question }[]>()
  private readonly impossible = new Map<string, Failure>()

  private identityPromise: Promise<{ process: string, reference: string }> | null = null

  private readonly transport = endpointTransport()

  public readonly signal = this.lifetime.signal

  public constructor() {
    this.transport.onClose(() => this.close())
    this.transport.onMessage(message => {
      const bytes = transportMessageBytes(message)
      if (!bytes) return

      let decoded: unknown
      try { decoded = deserialize(bytes) }
      catch { return }
      if (!Array.isArray(decoded) || typeof decoded[0] !== "string") return

      const [route, ...values] = decoded as [string, ...unknown[]]

      if (route === "boundary") {
        const [operation, ...rest] = values

        if (operation === "forget" && typeof rest[0] === "string") this.forgetIncoming(rest[0])

        if (operation === "impossible" && typeof rest[0] === "string" && typeof rest[1] === "string") {
          this.impossible.get(rest[0])?.(new Error(rest[1]))
          this.impossible.delete(rest[0])
        }

        return
      }

      if (values[0] === "stream" && typeof values[1] === "string" && typeof values[2] === "string") {
        this.receiveStream(values[1], values[2], values[3])
        return
      }

      if (values[0] === "answer" && typeof values[1] === "string") {
        this.settle(values[1], values.at(-1) as Outcome)
        return
      }

      if (values[0] === "wait" && typeof values[1] === "string" && typeof values[2] === "string" && typeof values[3] === "string") {
        this.receiveQuestion(route, values.slice(3), { address: values[1], id: values[2] })
        return
      }

      this.deliver(route, values)
    })

    this.transport.send(serialize(["boundary", "ready"]))
  }

  public send(route: string, ...values: unknown[]) {
    this.transport.send(serialize([route, ...values]))
  }

  public request(values: unknown[], timeout = defaultTimeout): Promise<unknown> {
    if (this.signal.aborted) return Promise.reject(this.signal.reason)
    return this.requestWithin(values, new Deadline(timeout))
  }

  public requestWithin(values: unknown[], deadline: Deadline): Promise<unknown> {
    if (this.signal.aborted) return Promise.reject(this.signal.reason)
    const question = randomUUID()

    return new Promise((resolve, reject) => {
      this.send("boundary", "expect", question)

      const timer = setTimeout(() => {
        this.pending.delete(question)
        this.send("boundary", "forget", question)
        reject(new Error(`Answer timeout ${deadline.milliseconds}ms`))
      }, deadline.remaining())

      this.pending.set(question, { resolve, reject, timer })
      this.send("end-host", "wait", question, ...values)
    })
  }

  /** Opens one long-running system operation and yields its ordered values. */
  public stream(values: unknown[], timeout = defaultTimeout, signal?: AbortSignal): AsyncIterableIterator<unknown> {
    const wire = this

    return (async function* () {
      const question = randomUUID()
      const state: PendingStream = {
        queue: [],
        opened: false,
        ended: false,
        failure: null,
        wake: null,
        timer: setTimeout(() => {
          state.failure = new Error(`Answer timeout ${timeout}ms`)
          state.wake?.()
          state.wake = null
        }, timeout)
      }
      const abort = () => {
        state.failure = signal?.reason instanceof Error ? signal.reason : new Error("The operation was cancelled")
        state.wake?.()
        state.wake = null
      }

      if (signal?.aborted) abort()
      else signal?.addEventListener("abort", abort, { once: true })

      wire.send("boundary", "expect", question)
      wire.streams.set(question, state)
      wire.send("end-host", "stream", question, ...values)

      try {
        while (true) {
          if (state.queue.length) {
            yield state.queue.shift()
            continue
          }

          if (state.failure) throw state.failure
          if (state.ended) return

          await new Promise<void>(resolve => { state.wake = resolve })
        }
      } finally {
        signal?.removeEventListener("abort", abort)
        clearTimeout(state.timer)
        wire.streams.delete(question)
        wire.send("boundary", "forget", question)
      }
    })()
  }

  /** Resolves this endpoint's Process address only for operations that need it. */
  public identity() {
    if (!this.identityPromise) {
      const resolving = this.request(["current-process"]).then(value => {
        const [record] = value as [{ identity?: unknown, reference?: unknown }]
        if (typeof record?.identity !== "string" || typeof record.reference !== "string") {
          throw new Error("The system returned an invalid Process identity")
        }
        return { process: record.identity, reference: record.reference }
      })
      const retained = resolving.catch(error => {
        if (this.identityPromise === retained) this.identityPromise = null
        throw error
      })
      this.identityPromise = retained
    }
    return this.identityPromise
  }

  public expectWithin(question: string, deadline: Deadline): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.send("boundary", "expect", question)

      const timer = setTimeout(() => {
        this.pending.delete(question)
        this.send("boundary", "forget", question)
        reject(new Error(`Answer timeout ${deadline.milliseconds}ms`))
      }, deadline.remaining())

      this.pending.set(question, { resolve, reject, timer })
    })
  }

  public forget(question: string) {
    const pending = this.pending.get(question)

    if (pending) clearTimeout(pending.timer)

    this.pending.delete(question)
    this.send("boundary", "forget", question)
  }

  public on(route: string, event: string, handler: Handler, subject: string | null = null, impossible?: Failure): Cleanup {
    const key = `${route}:${event}`
    const handlers = this.subscribers.get(key) ?? new Set()
    handlers.add(handler)
    this.subscribers.set(key, handlers)

    const subscription = this.register("publish", route, event, subject, impossible)

    return once(() => {
      handlers.delete(handler)
      if (!handlers.size) this.subscribers.delete(key)
      this.unregister(subscription)
    })
  }

  public onAll(route: string, handler: Handler, subject: string | null = null, impossible?: Failure): Cleanup {
    const handlers = this.every.get(route) ?? new Set()
    handlers.add(handler)
    this.every.set(route, handlers)

    const subscription = this.register("publish", route, null, subject, impossible)

    return once(() => {
      handlers.delete(handler)
      if (!handlers.size) this.every.delete(route)
      this.unregister(subscription)
    })
  }

  public answer(route: string, event: string, handler: Handler): Cleanup {
    const key = `${route}:${event}`

    if (this.answerers.has(key)) throw new Error(`The "${event}" event already has an answerer`)

    this.answerers.set(key, handler)
    const subscription = this.register("ask", route, event, null)
    this.releaseWaiting(route, event)

    return once(() => {
      if (this.answerers.get(key) === handler) this.answerers.delete(key)
      this.unregister(subscription)
    })
  }

  public observe(
    target: HandleAddress | null,
    half: "server" | "client",
    kind: TrafficKind,
    event: string | null,
    handler: Handler,
    impossible?: Failure
  ): Cleanup {
    const subscription = randomUUID()
    const stop = this.on("observed", subscription, handler)

    if (impossible) this.impossible.set(subscription, impossible)

    this.send("end-host", "observe", subscription, target, half, kind, event, impossible !== undefined)

    return once(() => {
      stop()
      this.impossible.delete(subscription)
      this.send("end-host", "unobserve", subscription)
    })
  }

  /** Follow destinationless events emitted by one Endpoint. */
  public follow(
    target: HandleAddress | null,
    half: "server" | "client",
    event: string | null,
    handler: Handler,
    impossible?: Failure
  ): Cleanup {
    const subscription = randomUUID()
    const stop = this.on("emitted", subscription, handler)

    if (impossible) this.impossible.set(subscription, impossible)

    this.send("end-host", "follow", subscription, target, half, event, impossible !== undefined)

    return once(() => {
      stop()
      this.impossible.delete(subscription)
      this.send("end-host", "unfollow", subscription)
    })
  }

  /** Follow one exact service lifecycle or application event route. */
  public followService(
    key: ServiceKey,
    scope: "lifecycle" | "events",
    event: string | null,
    handler: Handler
  ): Cleanup {
    const subscription = randomUUID()
    const stop = this.on("service-event", subscription, handler)

    this.send("end-host", "service-follow", subscription, key, scope, event)

    return once(() => {
      stop()
      this.send("end-host", "service-unfollow", subscription)
    })
  }

  private register(kind: TrafficKind, route: string, event: string | null, subject: string | null, impossible?: Failure) {
    const subscription = randomUUID()

    if (impossible) this.impossible.set(subscription, impossible)

    this.send("boundary", "subscribe", subscription, kind, route, event, subject, impossible !== undefined)
    return subscription
  }

  private unregister(subscription: string) {
    this.impossible.delete(subscription)
    this.send("boundary", "unsubscribe", subscription)
  }

  private deliver(route: string, values: unknown[]) {
    const [event, ...message] = values
    if (typeof event !== "string") return

    const handlers = [...this.subscribers.get(`${route}:${event}`) ?? []]
    for (const handler of handlers) invoke(handler, message)

    const observers = [...this.every.get(route) ?? []]
    for (const observer of observers) invoke(observer, [event, ...message])
  }

  private receiveQuestion(route: string, values: unknown[], question: Question) {
    const [event, ...message] = values
    if (typeof event !== "string") return

    const answerer = this.answerers.get(`${route}:${event}`)

    if (!answerer) {
      const key = `${route}:${event}`
      const waiting = this.waiting.get(key) ?? []
      waiting.push({ values, question })
      this.waiting.set(key, waiting)
      return
    }

    let result: unknown

    try {
      result = answerer(...message)
    } catch (error) {
      this.sendAnswer(route, question, event, failed(error))
      return
    }

    Promise.resolve(result).then(
      answer => this.sendAnswer(route, question, event, { success: true, result: answer }),
      error => this.sendAnswer(route, question, event, failed(error))
    )
  }

  private sendAnswer(route: string, question: Question, event: string, outcome: Outcome) {
    this.send(route, "answer", question.address, question.id, event, outcome)
  }

  private releaseWaiting(route: string, event: string) {
    const key = `${route}:${event}`
    const waiting = this.waiting.get(key)
    if (!waiting) return

    this.waiting.delete(key)
    for (const held of waiting) this.receiveQuestion(route, held.values, held.question)
  }

  private forgetIncoming(question: string) {
    for (const [key, waiting] of this.waiting) {
      const remaining = waiting.filter(entry => entry.question.address !== question)
      if (remaining.length) this.waiting.set(key, remaining)
      else this.waiting.delete(key)
    }
  }

  private settle(question: string, outcome: Outcome) {
    const pending = this.pending.get(question)
    if (!pending) return

    this.pending.delete(question)
    clearTimeout(pending.timer)
    this.send("boundary", "forget", question)

    if (outcome?.success === true) pending.resolve(outcome.result)
    else if (outcome?.success === false && typeof outcome.error === "string") pending.reject(new Error(outcome.error))
    else pending.reject(new Error("The boundary returned an invalid outcome"))
  }

  private receiveStream(question: string, operation: string, value: unknown) {
    const stream = this.streams.get(question)
    if (!stream || stream.ended || stream.failure) return

    if (operation === "open") {
      if (stream.opened) return
      stream.opened = true
      clearTimeout(stream.timer)
    } else if (!stream.opened) {
      stream.failure = new Error("The boundary produced a stream value before opening the stream")
    } else if (operation === "data") {
      if (stream.queue.length >= maximumStreamQueue) {
        stream.failure = new Error(`System stream queue exceeded its capacity of ${maximumStreamQueue}`)
      } else {
        stream.queue.push(value)
      }
    } else if (operation === "answer") {
      const outcome = value as Outcome

      if (outcome?.success === true) stream.ended = true
      else if (outcome?.success === false && typeof outcome.error === "string") stream.failure = new Error(outcome.error)
      else stream.failure = new Error("The boundary returned an invalid stream outcome")
    } else {
      stream.failure = new Error(`The boundary returned an invalid stream operation "${operation}"`)
    }

    stream.wake?.()
    stream.wake = null
  }

  private close() {
    if (this.signal.aborted) return

    const error = new Error("This System connection is closed")
    this.lifetime.abort(error)

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()

    for (const stream of this.streams.values()) {
      clearTimeout(stream.timer)
      stream.failure = error
      stream.wake?.()
      stream.wake = null
    }
  }
}

function endpointTransport(): EndpointTransport {
  const worker = parentPort

  if (worker) return {
    onMessage: listener => worker.on("message", listener),
    onClose: listener => worker.once("close", listener),
    send: message => worker.postMessage(message)
  }

  return {
    onMessage: listener => { process.on("message", listener) },
    onClose: listener => { process.once("disconnect", listener) },
    send: message => { process.send?.(message) }
  }
}

function transportMessageBytes(value: unknown) {
  if (value instanceof Uint8Array) return Uint8Array.from(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  if (value === null || typeof value !== "object") return null

  const record = value as Record<string, unknown>
  const bytes = new Uint8Array(Object.keys(record).length)

  for (let index = 0; index < bytes.length; index++) {
    const byte = record[String(index)]
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) return null
    bytes[index] = byte
  }

  return bytes
}

interface EndpointTransport {
  onMessage(listener: (message: unknown) => void): void
  onClose(listener: () => void): void
  send(message: Uint8Array): void
}

const maximumStreamQueue = 256

function failed(error: unknown): Outcome<never> {
  return {
    success: false,
    error: error instanceof Error ? error.message : "An unknown exception occurred"
  }
}

function invoke(handler: Handler, values: unknown[]) {
  Promise.resolve().then(() => handler(...values)).catch(error => {
    queueMicrotask(() => { throw error })
  })
}

function once(cleanup: Cleanup): Cleanup {
  let active = true
  return () => {
    if (!active) return
    active = false
    cleanup()
  }
}

export default new Wire()
