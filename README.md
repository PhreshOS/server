# `@phreshos/server`

The Server SDK defines the contextual capabilities available inside a
Program's server endpoint.

## Package status

This package is one component of a larger architecture that is still under
active testing. The architecture's components will be released in stages as
their contracts and integrations are verified.

`@phreshos/server` is not intended to be used on its own. It requires the
shared contracts from `@phreshos/core` and a compatible System runtime to provide
its runtime boundary.

It uses the domain objects and shared contracts from `@phreshos/core` through
a peer dependency. It does not redefine those objects, own client-side
capabilities, or contain System and transport implementations.

Its `System` contract exposes the complete unresolved Appearance with
replacement authority, authoritative Program and Process discovery, runtime
Program creation, lifecycle events, and publicly served values.
`system.appearance.snapshot()` explicitly reads current authoritative state;
`subscribe("change", listener)` receives only replacements published after
registration, and `update()` validates and persists a complete replacement.
Wallpaper filenames are ordinary Appearance values rather than separate SDK
capabilities:

```ts
const served = await system.serve(file)
const appearance = await system.appearance.snapshot()

await system.appearance.update({
  ...appearance,
  desktopWallpaper: {
    ...appearance.desktopWallpaper,
    light: served.file
  }
})
```

Its JavaScript entry point adapts the Process IPC boundary to these contracts.
The SDK owns callbacks, waits, queues, and their cleanup; the boundary owns
only the forwarding registrations requested by the SDK.

Importing the SDK injects no message into the child process. The endpoint may
announce its readiness outward, but identity, Theme, Process, readiness,
lifecycle, and application values enter only in response to an explicit request
or a live registration made by Program code.

`Current` combines navigation into the executing Server's Process with its
Channel and answer registry. The paired Client is explicitly named
as `current.client`; its publishing, existence, lifecycle, and Window operations
never masquerade as properties of `current`. `current.stop()` stops the
executing Server, while complete Process exit remains available only through
`current.process()`. It is the canonical Process-owned handle, so
`current.client === (await current.process()).client`.
Endpoint `process()` navigation is asynchronous; contextual ownership is
requested only when navigation needs it and then retained by the SDK.

All domain handles are canonical within this Server runtime's JavaScript realm.
Lookup, navigation, event payloads, and message metadata reuse the same weakly
retained handle. Server and Client handles remain stable for their Process
lifetime. Each Client permanently owns one synchronous `window` capability,
whose operations address that Client's current live presentation state.

Local representation and Surface presentation are deliberately absent from the
Server SDK. Client-side Window handles expose them through `window.local`; a
Server may coordinate Program state, but it neither owns nor controls the
resulting desktop material.

The package provides two contextual runtime entry points:

```ts
import { system, current } from "@phreshos/server"
```

It also re-exports the shared Core runtime classes—`Program`, `Process`,
`Endpoint`, `Server`, and `Client`—and refines the handles returned through
them. These are the same domain classes used by the Client SDK, so
`instanceof Server` and `instanceof Client` retain one meaning. `Window`, like
`ClientTraffic`, is a type-only capability owned by Client and has no
independent `instanceof` identity.

The current Server's Channel is composed directly into `current`. It receives
addressed events, emits destinationless events through `publish()`, and
registers answerers for questions arriving at this Server. An answerer that
omits its return value successfully answers with `undefined`. Answer
registration returns its sole cleanup function. Directed publishing to the
paired Client belongs to `current.client`.

An Endpoint handle is also a selective source: `endpoint.subscribe()` follows
destinationless events emitted by that Endpoint. Its `traffic` property remains
reserved for directed publications, questions, and answers.

`server.ask()` does not route a question before the addressed Server
incarnation is ready. The Server SDK owns one deadline across readiness and the
answer; absence or incarnation loss rejects without turning a boundary into a
waiter.

Server Program handles add `install()` and `fork()`. `install()` is an async
generator that opens immediately, yields ordered `stdout` and `stderr` command
chunks, completes only after installation succeeds, and throws the owning
System error when installation fails. Their `Storage` values also expose
`path()` and traversal-safe `resolve()`, because filesystem work is performed
locally in the Server SDK after the System supplies only the area root.
Object descriptions passed to `system.program.create()` therefore require an
explicit absolute storage root as well as at least one declared Endpoint.

`system.storage` implements that same refined `Storage` contract against the
native operating-system home directory. The System supplies the authoritative
root; traversal and symbolic-link escape remain rejected by the SDK before any
filesystem operation.

System registries are separated by owner. Reads, commands, and the complete
subscription contract live on their relevant capability rather than directly
on `system`:

```ts
const programs = await system.program.list()
const program = await system.program.find("counter")
const processes = await system.process.list()

const stopPrograms = system.program.subscribe("create", value => undefined)
const stopProcesses = system.process.subscribe("exit", value => undefined)
```

A Program owns its scoped Process capability:

```ts
const processes = await program.process.list()
const process = await program.process.find("worker")
const created = await program.process.create({ name: "worker" })
const shared = await program.process.findOrCreate({
  name: "shared-server",
  server: true,
  client: false
})
```

`findOrCreate()` is atomic at the authoritative Core. Concurrent equivalent
launches converge on one named Process; a different launch for that name
rejects instead of reconfiguring the existing Process.

`system.service(key)` creates the exact opaque service handle. The
handler exposes its authored `name`, `enabled()`, `waitReady()`, lifecycle
subscriptions, and channel; it does not expose its Program or Endpoint as
separate fields. Services are runtime bindings explicitly enabled by their
providing Endpoints; creating the providing Process remains the Program's
responsibility.

Readiness accepts an optional timeout directly:

```ts
await service.waitReady(10_000)
```

Programs may provide one agent-independent operating document. Its availability
is projected without loading it, and its content is read from the Program:

```ts
if (program.hasAgent) console.log(await program.agent())
```

`program.icon()` requests a guaranteed PNG `Blob` in `small`, `medium`, or
`large` form without exposing the Program's source path or the system's private
asset-hosting address. Omitting the size selects `medium`.

Installed Programs may persist one ordinary Process launch for the next system
startup. This capability exists only in the Server SDK:

```ts
await program.startup.enable({
  name: "main",
  server: true,
  client: false,
  options: { mode: "worker" }
})

const launch = await program.startup.get() // Launch | null

await program.startup.disable()
```

The system validates this through the same launch contract as
`program.process.create()`. Setting startup does not create a Process immediately.
`uninstall(false)` preserves the configuration but makes it inactive until the
Program is installed again; removing everything deletes it.

Installation and uninstallation expose any declared Server command output as
ordered streams. Consuming the generator waits for the authoritative operation
to finish:

```ts
for await (const chunk of program.install()) {
  (chunk.stream === "stderr" ? process.stderr : process.stdout).write(chunk.text)
}

for await (const chunk of program.uninstall(true)) {
  (chunk.stream === "stderr" ? process.stderr : process.stdout).write(chunk.text)
}
```
