import type {
  Capture,
  Cleanup,
  EventOptions
} from "@phreshos/core"

export const defaultTimeout = 10_000

type Failure = (error: Error) => void
type Listener = (message: unknown) => unknown
type EveryListener = (event: string, message: unknown) => unknown
type Register<Message> = (listener: (message: Message) => unknown, impossible?: Failure) => Cleanup

/**
 * SDK-owned subscription behavior over one boundary registration source.
 *
 * The boundary owns forwarding state only. Promises, deadlines, queues and
 * callbacks remain here, inside the endpoint that requested the data.
 */
export default class Events {

  public constructor(
    private readonly listen: (event: string, listener: Listener, impossible?: Failure) => Cleanup,
    private readonly listenAll: (listener: EveryListener, impossible?: Failure) => Cleanup
  ) {}

  public subscribe(event: string, subscriber: Listener): Cleanup
  public subscribe(subscriber: (capture: Capture<string, unknown>) => unknown): Cleanup
  public subscribe(eventOrSubscriber: string | ((capture: Capture<string, unknown>) => unknown), subscriber?: Listener): Cleanup {
    if (typeof eventOrSubscriber === "string") return this.listen(eventOrSubscriber, subscriber as Listener)
    return this.listenAll((event, message) => eventOrSubscriber({ event, message }))
  }

  public waitFor(event: string, timeout = defaultTimeout): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false
      let stop: Cleanup = () => undefined

      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stop()
        settle()
      }

      const timer = setTimeout(() => {
        finish(() => reject(new Error(`Event promise timeout ${timeout}ms`)))
      }, timeout)

      stop = this.listen(
        event,
        message => finish(() => resolve(message)),
        error => finish(() => reject(error))
      )
    })
  }

  public events(event: string, options?: EventOptions): AsyncIterableIterator<unknown>
  public events(options?: EventOptions): AsyncIterableIterator<Capture<string, unknown>>
  public events(eventOrOptions: string | EventOptions = {}, namedOptions: EventOptions = {}) {
    if (typeof eventOrOptions === "string") {
      return stream((listener, impossible) => this.listen(eventOrOptions, listener, impossible), namedOptions)
    }

    return stream<Capture<string, unknown>>(
      (listener, impossible) => this.listenAll((event, message) => listener({ event, message }), impossible),
      eventOrOptions
    )
  }
}

/** Converts one persistent registration into a bounded asynchronous iterator. */
export function stream<Message>(register: Register<Message>, options: EventOptions = {}): AsyncIterableIterator<Message> {
  const capacity = options.capacity ?? 64
  if (capacity !== Infinity && (!Number.isInteger(capacity) || capacity < 0)) {
    throw new Error("An event queue capacity must be a non-negative integer or Infinity")
  }

  return (async function* () {
    const queue: Message[] = []
    let ended = false
    let failure: Error | null = null
    let wake: (() => void) | null = null

    const stop = register(
      message => {
        if (ended || failure) return
        if (queue.length >= capacity) failure = new Error(`Event queue exceeded its capacity of ${capacity}`)
        else queue.push(message)
        wake?.()
        wake = null
      },
      error => {
        if (ended || failure) return
        failure = error
        wake?.()
        wake = null
      }
    )

    const abort = () => {
      ended = true
      wake?.()
      wake = null
    }

    options.signal?.addEventListener("abort", abort, { once: true })
    if (options.signal?.aborted) abort()

    try {
      while (!ended) {
        if (queue.length) {
          yield queue.shift() as Message
          continue
        }
        if (failure) throw failure
        await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      ended = true
      stop()
      options.signal?.removeEventListener("abort", abort)
    }
  })()
}
