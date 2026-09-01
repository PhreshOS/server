# `@phreshos/server`

The SDK for a PhreshOS Program's Server Endpoint.

The Server SDK adapts the host-side child-process or Worker boundary to the
shared Core domain model. It exposes the authoritative `system` and
`context` available inside a Server without redefining Program, Process,
Endpoint, Server, or Client.

## Installation

| Package manager | Command |
| --- | --- |
| npm | `npm install @phreshos/server` |
| pnpm | `pnpm add @phreshos/server` |
| Bun | `bun add @phreshos/server` |
| Yarn | `yarn add @phreshos/server` |

`@phreshos/core` is a peer dependency.

## Context

```ts
import { context } from "@phreshos/server"

context.answer("counter.read", async () => {
  return { value: 1 }
})

context.publish("changed", { value: 1 })

const program = await context.program()
const process = await context.process()
const client = context.client
```

`context` belongs to the executing Server. It provides communication, question
answering, navigation to its Program and Process, its paired Client, and
Server-owned capabilities.

## System

```ts
import { system } from "@phreshos/server"

const programs = await system.program.list()
const processes = await system.process.list()
const appearance = await system.appearance.snapshot()

const service = system.service({
  program: "browser",
  process: "main",
  endpoint: "server",
})
```

The Server System exposes authoritative registries, Appearance, storage,
uploads, Fetch, and exact Service handles. Requests read current state.
Subscriptions observe future publications and do not replay an initial value.

The same SDK surface works in both supported Server execution modes:
`startCommand` child processes and System-owned `entryFile` Workers.

## Development

```sh
bun install --frozen-lockfile
bun run verify
```

`verify` checks the source, both Server runtime adapters, build, and published
package shape.

See the [Client and Server documentation](https://github.com/PhreshOS/docs/blob/main/content/docs/sdks/client-and-server.mdx)
for the shared model and authority boundary.

## Repository boundary

This repository owns the Server runtime adapter. Core owns the domain model and
the System owns authoritative execution, persistence, and routing.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
