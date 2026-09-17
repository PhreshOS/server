import type { ShellEvent, ShellOptions } from "@phreshos/core"
import wire from "./wire.js"

/** Execute one command through the permission-constrained System boundary. */
export default function shell(command: string, options: ShellOptions = {}): AsyncGenerator<ShellEvent, void, void> {
  if (typeof command !== "string" || !command.trim()) throw new Error("A shell command must be non-empty text")
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Shell options must be an object")
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new Error("A shell signal must be an AbortSignal")
  if (options.cwd !== undefined && (typeof options.cwd !== "string" || !options.cwd)) throw new Error("A shell working directory must be non-empty text")
  if (options.env !== undefined && (!options.env || typeof options.env !== "object" || Array.isArray(options.env) || Object.values(options.env).some(value => typeof value !== "string"))) {
    throw new Error("Shell environment values must be text")
  }

  const signal = options.signal ? AbortSignal.any([options.signal, wire.signal]) : wire.signal
  const forwarded = {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env })
  }
  const stream = wire.stream(["shell", command, forwarded], undefined, signal)

  return (async function* () {
    for await (const value of stream) yield value as ShellEvent
  })()
}
