import { expect, test, vi } from "vitest"
import Events from "../source/events.js"

test("wait resolves the next event and releases its boundary registration", async () => {
  let deliver: ((message: unknown) => unknown) | undefined
  const stop = vi.fn()
  const events = new Events<{ ready: number }, never>((name, listener) => {
    expect(name).toBe("ready")
    deliver = listener
    return stop
  }, () => vi.fn())

  const waiting = events.wait("ready", 1_000)
  deliver?.(42)
  await expect(waiting).resolves.toBe(42)
  expect(stop).toHaveBeenCalledOnce()
})

test("wait timeout releases the registration and rejects", async () => {
  vi.useFakeTimers()
  try {
    const stop = vi.fn()
    const events = new Events<{ ready: number }, never>(() => stop, () => vi.fn())
    const rejected = expect(events.wait("ready", 10)).rejects.toThrow("timeout")
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    expect(stop).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})

test("wait preserves a boundary failure and releases the registration", async () => {
  let fail: ((error: Error) => void) | undefined
  const stop = vi.fn()
  const events = new Events<{ ready: number }, never>((_name, _listener, impossible) => {
    fail = impossible
    return stop
  }, () => vi.fn())
  const failure = new Error("Endpoint stopped")
  const waiting = events.wait("ready", 1_000)
  fail?.(failure)
  await expect(waiting).rejects.toBe(failure)
  expect(stop).toHaveBeenCalledOnce()
})
