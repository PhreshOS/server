import assert from "node:assert/strict"
import { execFileSync, fork, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deserialize as decode } from "@the-link/messagepack"
import { FrameReader } from "@the-link/ipc/framing"
import manifest from "../package.json" with { type: "json" }
import { test } from "vitest"

test("package contract", async () => {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const temporary = mkdtempSync(join(tmpdir(), "phreshos-server-package-"))
  const cache = join(temporary, "npm-cache")
  const coreCandidate = process.env.PHRESHOS_CORE_PACKAGE
  const corePackage = `@phreshos/core@${manifest.devDependencies["@phreshos/core"]}`

  assert.equal(
    manifest.peerDependencies["@phreshos/core"],
    manifest.devDependencies["@phreshos/core"],
    "the published Core peer must match the verified Core dependency"
  )

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
        coreCandidate ?? corePackage
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

  globalThis.__PHRESHOS_SERVER_TRANSPORT__ = Object.freeze({
    send() {},
    onMessage() {},
    onClose() {}
  })
  const sdk = await import("@phreshos/server")
  const { context, system } = sdk

  const { ClientEndpoint, ClientService, Endpoint, Process, Program, ServerEndpoint, ServerService, Service } = core

  assert.deepEqual(Object.keys(sdk).sort(), ["context", "system"])
  for (const shared of ["Program", "Process", "Endpoint", "ServerEndpoint", "ClientEndpoint", "Service", "ServerService", "ClientService"]) {
    assert.equal(shared in sdk, false)
  }
  assert.equal("current" in sdk, false)
  assert.equal(typeof context.process, "function")
  assert.equal(typeof context.name, "function")
  assert.equal(typeof context.client.window, "object")
  assert.equal("local" in context.client.window, false)
  assert.equal(typeof context.isService, "function")
  assert.equal("channel" in context, false)
  assert.equal(typeof context.client.isService, "function")
  assert.equal(typeof context.client.waitReady, "function")
  assert.equal(typeof system.appearance.snapshot, "function")
  assert.equal(typeof system.uploads.write, "function")
  assert.equal(typeof system.uploads.path, "function")
  assert.equal(typeof system.uploads.stream, "function")
  assert.equal(typeof system.uploads.stat, "function")
  assert.equal("serve" in system, false)
  assert.equal(typeof system.storage.file, "function")
  assert.equal(typeof system.storage.navigate, "function")
  assert.equal(typeof system.program.list, "function")
  assert.equal(typeof system.program.forceCreate, "function")
  assert.equal("forceCreateProgram" in system, false)
  assert.equal(typeof system.process.list, "function")
  assert.equal(typeof system.authentication.state, "function")
  assert.equal(typeof system.authentication.setCredentials, "function")
  assert.equal(typeof system.authentication.signOutAllSessions, "function")
  assert.equal(typeof system.service, "object")
  assert.equal(typeof system.service.prepare, "function")
  assert.equal(typeof system.service.list, "function")
  assert.equal(typeof system.network.websocket, "function")
  assert.equal(typeof system.network.fetch, "function")
  assert.equal("fetch" in system, false)
  assert.equal("websocket" in system, false)
  assert.equal(typeof system.shell, "function")
  assert.equal("subscribe" in system, false)
  const service = system.service.prepare({ program: "counter", process: "main", endpoint: "server" })
  const clientService = system.service.prepare({ program: "counter", process: "main", endpoint: "client" })
  assert.equal(service, system.service.prepare({ program: "counter", process: "main", endpoint: "server" }))
  assert.equal(clientService, system.service.prepare({ program: "counter", process: "main", endpoint: "client" }))
  assert.throws(() => system.service.prepare({ process: "main", endpoint: "server" }), /complete Service address/)
  assert(service instanceof Service)
  assert(service instanceof ServerService)
  assert(clientService instanceof Service)
  assert(clientService instanceof ClientService)
  assert.deepEqual(service.address(), { program: "counter", process: "main", endpoint: "server" })
  assert.equal(typeof service.available, "function")
  assert.equal(typeof service.programMetadata, "function")
  assert.equal(typeof service.programIcon, "function")
  assert.equal(typeof service.waitReady, "function")
  assert.equal(typeof clientService.waitReady, "function")
  assert.equal(typeof clientService.publish, "function")
  assert.equal(typeof service.subscribe, "function")
  assert.equal(typeof service.lifecycle.subscribe, "function")
  assert.equal("channel" in service, false)
  `
    )
    execFileSync(process.execPath, [join(consumer, "runtime.mjs")], {
      cwd: consumer,
      stdio: "inherit"
    })

    writeFileSync(
      join(consumer, "startup.mjs"),
      `import { system } from "@phreshos/server"
  system.service.prepare({ program: "counter", process: "main", endpoint: "server" })
  setTimeout(() => process.exit(0), 25)
  `
    )
    const messages = await childMessages(join(consumer, "startup.mjs"), consumer)
    assert.equal(messages.length, 1)
    assert(messages[0] instanceof Uint8Array)
    assert.deepEqual(decode(messages[0]), ["boundary", "ready"])

    const socketMessages = await socketChildMessages(join(consumer, "startup.mjs"), consumer)
    assert.equal(socketMessages.length, 1)
    assert.deepEqual(decode(socketMessages[0]), ["boundary", "ready"])

    writeFileSync(
      join(consumer, "consumer.ts"),
      `import { context, system } from "@phreshos/server"
  import { ClientEndpoint, ServerEndpoint, type Appearance, type Endpoint, type FileStat, type Process, type Program, type ServerService, type ShellEvent, type SystemUploads, type Upload, type WritableContent } from "@phreshos/core"
  // @ts-expect-error the runtime object is named context
  import { current } from "@phreshos/server"
  // @ts-expect-error shared domains are imported from Core, not republished by an environment SDK
  import { Service } from "@phreshos/server"

  type CounterEvents = { change: number }

  const appearance: Promise<Appearance> = system.appearance.snapshot()
  const appearanceUpdate: Promise<void> = system.appearance.update({ colors: { dark: { danger: "#ff0000" } } })
  const authenticationState: Promise<import("@phreshos/core").AuthenticationState> = system.authentication.state()
  const authenticationConnections: Promise<import("@phreshos/core").Connection[]> = system.authentication.connections()
  const uploads: SystemUploads = system.uploads
  const uploadsPath: Promise<string> = uploads.path()
  const upload: Promise<Upload> = uploads.write("hello")
  const uploadStat: Promise<FileStat | null> = uploads.stat("00000000-0000-0000-0000-000000000000.txt")
  const uploadContent: WritableContent = new Uint16Array([1, 2])
  const uploadText: Promise<string> = uploads.text("00000000-0000-0000-0000-000000000000.txt")
  const homeFile: Promise<string> = system.storage.file("example.txt").text()
  // @ts-expect-error selecting a file requires at least one path segment
  system.storage.file()
  const counter: ServerService<CounterEvents> = system.service.prepare<CounterEvents>({ program: "counter", process: "main", endpoint: "server" })
  const counterReady: Promise<void> = counter.waitReady(10_000)
  const clientService = system.service.prepare({ program: "counter", process: "main", endpoint: "client" })
  const counterStop = counter.subscribe("change", value => void value)
  const counterLifecycleStop = counter.lifecycle.subscribe("available", () => undefined)
  const counterAnswer: Promise<number> = counter.ask<number>("value")
  const serviceRole: Promise<boolean> = context.isService()
  const processName: Promise<string | null> = context.name()
  const stopAnswer = context.answer("outside", message => {
    const sender: Endpoint | null = message.from
    if (sender) void sender.process()
    return sender ? "endpoint" : "outside"
  })
  const program = await context.program()
  const hasAgent: boolean = program.hasAgent
  const agent: Promise<string | null> = program.agent()
  const definition = program.definition()
  const serviceMetadata = counter.programMetadata()
  const serviceIcon = counter.programIcon("small")
  const storedPermission = program.permissions.get("all")
  const permissions = program.permissions.all()
  const storedAllows: Promise<boolean> = program.permissions.allows("network", ["https://api.example.com"])
  const allowedPermission: Promise<void> = program.permissions.allow("all")
  const deniedPermission: Promise<void> = program.permissions.deny("all")
  const requestedPermission: Promise<import("@phreshos/core").Permission<"all">> = program.permissions.request("all")
  // @ts-expect-error Permission assignments are replaced or explicitly denied; they are never deleted.
  program.permissions.delete("all")
  // @ts-expect-error permission names are closed by the Core catalog
  program.permissions.get("files")
  const shared: Promise<Process> = program.findOrCreateProcess({
    name: "shared-server",
    server: { service: true },
    client: false
  })
  const stop = (await shared).client.lifecycle.subscribe("stop", () => undefined)
  const client: ClientEndpoint = context.client
  const start: Promise<void> = client.start({ title: "Prepared title" })
  const currentProcess = await context.process()
  const serverStart: Promise<void> = currentProcess.server.start({ service: true })
  // @ts-expect-error permissions belong to the Program, never one Process
  currentProcess.permissions
  const systemPrograms: Promise<Program[]> = system.program.list()
  const systemProgram: Promise<Program | null> = system.program.find("counter")
  const systemProcesses: Promise<Process[]> = system.process.list()
  const systemProcess: Promise<Process | null> = system.process.find("process-identity")
  const shell: AsyncGenerator<ShellEvent, void, void> = system.shell("printf hello", { cwd: "/tmp" })
  const forcedProgram: Promise<Program> = system.program.forceCreate("./phresh.config.ts")
  const geometry: Promise<void> = client.window.setGeometry({
    x: "0/1",
    y: "0/1",
    width: "1/2",
    height: "1/2"
  })
  type ServerWindowHasSurface = "surface" extends keyof ClientEndpoint["window"] ? true : false
  const serverWindowHasSurface: ServerWindowHasSurface = true
  type ServerWindowHasLocal = "local" extends keyof ClientEndpoint["window"] ? true : false
  const serverWindowHasLocal: ServerWindowHasLocal = false

  void appearance
  void upload
  void uploadText
  void homeFile
  void counter
  void serverStart
  void counterReady
  void clientService
  void counterStop
  void counterLifecycleStop
  void counterAnswer
  void serviceRole
  void processName
  void stopAnswer
  void hasAgent
  void agent
  void storedPermission
  void permissions
  void storedAllows
  void allowedPermission
  void deniedPermission
  void requestedPermission
  void shared
  void stop
  void client
  void start
  void shell
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

  async function socketChildMessages(entry, cwd) {
    const token = randomUUID()
    const identity = `ps-${randomUUID().replaceAll("-", "")}`
    const address = process.platform === "win32" ? `\\\\.\\pipe\\${identity}` : join(tmpdir(), `${identity}.sock`)
    const messages = []
    const server = createServer(socket => {
      const reader = new FrameReader(16 * 1024 * 1024)
      let authenticated = false

      socket.on("data", chunk => {
        for (const frame of reader.read(chunk)) {
          if (!authenticated) {
            authenticated = new TextDecoder().decode(frame) === token
            assert(authenticated, "the packed Server SDK used an invalid command transport token")
          } else messages.push(frame)
        }
      })
    })

    await new Promise((resolveListen, reject) => {
      server.once("error", reject)
      server.listen(address, resolveListen)
    })

    try {
      await new Promise((resolveChild, reject) => {
        const child = spawn(process.execPath, [entry], {
          cwd,
          stdio: "inherit",
          env: { ...process.env, PHRESHOS_SERVER_ADDRESS: address, PHRESHOS_SERVER_TOKEN: token }
        })

        child.once("error", reject)
        child.once("exit", (code, signal) => {
          if (code === 0 && signal === null) resolveChild()
          else reject(new Error(`the packed Server SDK socket process exited with code ${code} and signal ${signal}`))
        })
      })
    } finally {
      await new Promise(resolveClose => server.close(resolveClose))
      if (process.platform !== "win32") rmSync(address, { force: true })
    }

    return messages
  }
}, 120_000)
