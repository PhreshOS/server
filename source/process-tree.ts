import type { ChildProcess } from "node:child_process"

const terminationGrace = 1_000

/** The complete operating-system process tree beneath one shell command. */
export default class ProcessTree {
  private forcing: ReturnType<typeof setTimeout> | null = null

  public constructor(
    private readonly child: ChildProcess,
    private readonly ended: (code: number | null, signal: NodeJS.Signals | null) => void | Promise<void>
  ) {
    child.on("exit", (code, signal) => { this.finish(code, signal).catch(() => undefined) })
  }

  public stop() {
    signalTree(this.child, "SIGTERM")
    if (this.forcing) return
    this.forcing = setTimeout(() => signalTree(this.child, "SIGKILL"), terminationGrace)
    this.forcing.unref()
  }

  private async finish(code: number | null, signal: NodeJS.Signals | null) {
    if (this.forcing) clearTimeout(this.forcing)
    this.forcing = null
    await finishTree(this.child)
    await this.ended(code, signal)
  }
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return

  try { process.kill(-child.pid, signal) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
}

async function finishTree(child: ChildProcess) {
  const pid = child.pid
  if (!pid || !treeExists(pid)) return

  signalTree(child, "SIGTERM")
  if (await waitForTree(pid)) return
  signalTree(child, "SIGKILL")
  await waitForTree(pid)
}

async function waitForTree(pid: number) {
  const began = Date.now()

  while (treeExists(pid)) {
    if (Date.now() - began >= terminationGrace) return false
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  return true
}

function treeExists(pid: number) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}
