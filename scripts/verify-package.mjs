import assert from "node:assert/strict"
import { execFileSync, fork } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decode } from "@msgpack/msgpack"
import manifest from "../package.json" with { type: "json" }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const temporary = mkdtempSync(join(tmpdir(), "phreshos-server-package-"))
const cache = join(temporary, "npm-cache")

try {
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
    {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: cache }
    }
  )
  const packed = JSON.parse(output)[0]
  const paths = new Set(packed.files.map(file => file.path))

  assert(paths.has("dist/main.js"), "the package has no JavaScript entry point")
  assert(paths.has("dist/main.d.ts"), "the package has no declaration entry point")
  assert(paths.has("LICENSE"), "the package has no license")
  assert(paths.has("README.md"), "the package has no README")
  assert(paths.has("package.json"), "the package has no manifest")

  for (const path of paths) {
    assert(
      path === "LICENSE" || path === "README.md" || path === "package.json" || path.startsWith("dist/"),
      `private repository material entered the package: ${path}`
    )
  }

  const consumer = join(temporary, "consumer")
  const archive = join(temporary, packed.filename)

  mkdirSync(consumer)
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2)
  )
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      archive,
      `@phreshos/core@${manifest.devDependencies["@phreshos/core"]}`
    ],
    {
      cwd: consumer,
      stdio: "inherit",
      env: { ...process.env, npm_config_cache: cache }
    }
  )

  writeFileSync(
    join(consumer, "runtime.mjs"),
    `import assert from "node:assert/strict"
import * as core from "@phreshos/core"
import { Client, Endpoint, Process, Program, Server, ServerServiceHandler, ServiceHandler, current, host } from "@phreshos/server"

assert.equal(Program, core.Program)
assert.equal(Process, core.Process)
assert.equal(Endpoint, core.Endpoint)
assert.equal(Server, core.Server)
assert.equal(Client, core.Client)
assert.equal(typeof current.process, "function")
assert.equal(typeof current.client.window, "object")
assert.equal("local" in current.client.window, false)
assert.equal(typeof current.enableService, "function")
assert.equal(typeof current.disableService, "function")
assert.equal("enableService" in current.client, false)
assert.equal("disableService" in current.client, false)
assert.equal(typeof host.theme.snapshot, "function")
assert.equal(typeof host.desktopWallpaper.set, "function")
assert.equal(typeof host.program.list, "function")
assert.equal(typeof host.process.list, "function")
assert.equal(typeof host.service, "function")
assert.equal("subscribe" in host, false)
const service = host.service({ program: "counter", endpoint: "server", name: "state" })
assert.equal(service, host.service({ program: "counter", endpoint: "server", name: "state" }))
assert(service instanceof ServiceHandler)
assert(service instanceof ServerServiceHandler)
assert.equal("program" in service, false)
assert.equal("endpoint" in service, false)
assert.equal(typeof service.enabled, "function")
assert.equal(typeof service.waitReady, "function")
`
  )
  execFileSync(process.execPath, [join(consumer, "runtime.mjs")], {
    cwd: consumer,
    stdio: "inherit"
  })

  writeFileSync(
    join(consumer, "startup.mjs"),
    `import { host } from "@phreshos/server"
host.service({ program: "counter", endpoint: "server", name: "state" })
setTimeout(() => process.exit(0), 25)
`
  )
  const messages = await childMessages(join(consumer, "startup.mjs"), consumer)
  assert.equal(messages.length, 1)
  assert(messages[0] instanceof Uint8Array)
  assert.deepEqual(decode(messages[0]), ["boundary", "ready"])

  writeFileSync(
    join(consumer, "consumer.ts"),
    `import { current, host, Client, Server, type ServerServiceHandler, type ThemeProperties } from "@phreshos/server"

type CounterEvents = { change: number }

const theme: Promise<Readonly<ThemeProperties>> = host.theme.snapshot()
const counter: ServerServiceHandler<CounterEvents> = host.service<CounterEvents>({ program: "counter", endpoint: "server", name: "state" })
const counterReady: Promise<void> = counter.waitReady(10_000)
const clientService = host.service({ program: "counter", endpoint: "client", name: "window" })
const counterStop = counter.channel.subscribe("change", value => void value)
const counterAnswer: Promise<number> = counter.channel.ask<number>("value")
const expose: Promise<void> = current.enableService("state")
const program = await current.program()
const hasAgent: boolean = program.hasAgent
const agent: Promise<string | null> = program.agent()
const shared: Promise<import("@phreshos/server").Process> = program.process.findOrCreate({
  name: "shared-server",
  server: true,
  client: false
})
const stop = host.process.subscribe("endpointStop", endpoint => {
  if (endpoint instanceof Server) void endpoint.process()
  if (endpoint instanceof Client) void endpoint.window.size()
})
const client: Client = current.client
const start: Promise<void> = client.start({ title: "Prepared title" })
const geometry: Promise<void> = client.window.setGeometry({
  position: { x: "0/1", y: "0/1" },
  size: { width: "1/2", height: "1/2" }
})
type ServerWindowHasSurface = "surface" extends keyof Client["window"] ? true : false
const serverWindowHasSurface: ServerWindowHasSurface = false
type ServerWindowHasLocal = "local" extends keyof Client["window"] ? true : false
const serverWindowHasLocal: ServerWindowHasLocal = false

void theme
void counter
void counterReady
void clientService
void counterStop
void counterAnswer
void expose
void hasAgent
void agent
void shared
void stop
void client
void start
void geometry
void serverWindowHasSurface
void serverWindowHasLocal
`
  )
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["DOM", "ESNext"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ESNext"
        },
        include: ["consumer.ts"]
      },
      null,
      2
    )
  )

  const typescript = resolve(repository, "node_modules/typescript/bin/tsc")
  assert(readFileSync(typescript).length > 0, "TypeScript is not installed")
  execFileSync(process.execPath, [typescript, "-p", join(consumer, "tsconfig.json")], {
    cwd: consumer,
    stdio: "inherit"
  })
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

function childMessages(entry, cwd) {
  return new Promise((resolveMessages, reject) => {
    const messages = []
    const child = fork(entry, [], { cwd, serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] })

    child.on("message", message => messages.push(message))
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolveMessages(messages)
      else reject(new Error(`the packed Server SDK exited with code ${code} and signal ${signal}`))
    })
  })
}
