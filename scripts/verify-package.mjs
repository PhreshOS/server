import assert from "node:assert/strict"
import { execFileSync, fork } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
import { Client, Endpoint, Process, Program, Server, current, host } from "@phreshos/server"

assert.equal(Program, core.Program)
assert.equal(Process, core.Process)
assert.equal(Endpoint, core.Endpoint)
assert.equal(Server, core.Server)
assert.equal(Client, core.Client)
assert.equal(typeof current.process, "function")
assert.equal(typeof current.client.window, "object")
assert.equal(typeof host.theme.snapshot, "function")
assert.equal(typeof host.desktopWallpaper.set, "function")
`
  )
  execFileSync(process.execPath, [join(consumer, "runtime.mjs")], {
    cwd: consumer,
    stdio: "inherit"
  })

  writeFileSync(
    join(consumer, "startup.mjs"),
    `import "@phreshos/server"
setTimeout(() => process.exit(0), 25)
`
  )
  const messages = await childMessages(join(consumer, "startup.mjs"), consumer)
  assert.deepEqual(messages, [["boundary", "ready"]])

  writeFileSync(
    join(consumer, "consumer.ts"),
    `import { current, host, Client, Server, type ThemeProperties } from "@phreshos/server"

const theme: Promise<Readonly<ThemeProperties>> = host.theme.snapshot()
const stop = host.subscribe("endpointStop", endpoint => {
  if (endpoint instanceof Server) void endpoint.process()
  if (endpoint instanceof Client) void endpoint.window.surface.set()
})
const client: Client = current.client
const start: Promise<void> = client.start({ title: "Prepared title" })

void theme
void stop
void client
void start
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
    const child = fork(entry, [], { cwd, stdio: ["ignore", "inherit", "inherit", "ipc"] })

    child.on("message", message => messages.push(message))
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolveMessages(messages)
      else reject(new Error(`the packed Server SDK exited with code ${code} and signal ${signal}`))
    })
  })
}
