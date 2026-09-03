# `@phreshos/server`

The runtime adapter for a PhreshOS Program's Server Endpoint.

[Documentation](https://docs.phreshos.com/sdks/server) ·
[Server Context](https://docs.phreshos.com/runtime/context) ·
[Communication](https://docs.phreshos.com/runtime/communication) ·
[Source](https://github.com/PhreshOS/server)

## Role

The Server SDK exposes the complete Core `system` contract and the current
Server `context` inside both supported execution modes: supervised child
processes and System-owned Workers.

It adapts the execution boundary without redefining Program, Process, Endpoint,
or Service. The System remains authoritative for execution, persistence,
routing, and host capabilities.

## Installation

| Package manager | Command |
| --- | --- |
| npm | `npm install @phreshos/server` |
| pnpm | `pnpm add @phreshos/server` |
| Bun | `bun add @phreshos/server` |
| Yarn | `yarn add @phreshos/server` |

`@phreshos/core` is a peer dependency.

```ts
import { context, system } from "@phreshos/server"

context.answer("counter.read", async () => ({ value: 1 }))

const program = await context.program()
const appearance = await system.appearance.snapshot()
```

See [Server SDK](https://docs.phreshos.com/sdks/server) for the complete entry
points and execution contract.

## Development

```sh
bun install --frozen-lockfile
bun run verify
```

`verify` checks the types, both execution adapters, System operations, build,
and published package shape.

## Related repositories

- [`@phreshos/core`](https://github.com/PhreshOS/core) owns every shared
  contract and domain class exposed here.
- [`@phreshos/client`](https://github.com/PhreshOS/client) adapts the paired
  Client Endpoint boundary.
- [`@phreshos/node`](https://github.com/PhreshOS/node) exposes the same System
  contract to external Node.js code.
- [PhreshOS System](https://github.com/PhreshOS/system) owns execution,
  persistence, and routing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
