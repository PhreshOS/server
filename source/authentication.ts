import {
  Connection as CoreConnection,
  Session as CoreSession,
  parseConnectionSnapshot,
  parseSessionEndSnapshot,
  parseSessionSnapshot,
  type ConnectionEvents,
  type ConnectionSnapshot,
  type SessionEvents,
  type SessionSnapshot
} from "@phreshos/core"
import HandleRegistry from "./handle-registry.js"
import { scoped } from "./domain.js"
import wire from "./wire.js"

const handles = new HandleRegistry()

class ConnectionHandle extends CoreConnection {
  public readonly subscribe: CoreConnection["subscribe"]
  public readonly wait: CoreConnection["wait"]
  public readonly events: CoreConnection["events"]
  public readonly identity: string

  public constructor(snapshot: ConnectionSnapshot) {
    super()
    this.identity = snapshot.identity
    const events = scoped<ConnectionEvents, never>("connection-host", this.identity, connectionEvent)
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public async connected() {
    const [snapshot] = await wire.request(["host-connection-state", this.identity]) as [unknown]
    return parseConnectionSnapshot(snapshot).connected
  }

  public async session() {
    const [snapshot] = await wire.request(["host-connection-session", this.identity]) as [unknown]
    return snapshot === null ? null : session(snapshot)
  }

  public async signIn() {
    const [snapshot] = await wire.request(["host-connection-sign-in", this.identity]) as [unknown]
    return session(snapshot)
  }
}

class SessionHandle extends CoreSession {
  public readonly subscribe: CoreSession["subscribe"]
  public readonly wait: CoreSession["wait"]
  public readonly events: CoreSession["events"]
  public readonly identity: string

  public constructor(snapshot: SessionSnapshot) {
    super()
    this.identity = snapshot.identity
    const events = scoped<SessionEvents, never>("session-host", this.identity, (event, values) => sessionEvent(this.identity, event, values))
    this.subscribe = events.subscribe
    this.wait = events.wait
    this.events = events.events
  }

  public async valid() {
    const [snapshot] = await wire.request(["host-session-state", this.identity]) as [unknown]
    return parseSessionSnapshot(snapshot).valid
  }

  public async connections() {
    const [snapshots] = await wire.request(["host-session-connections", this.identity]) as [unknown[]]
    return snapshots.map(connection)
  }

  public async signOut() {
    await wire.request(["host-session-sign-out", this.identity])
  }
}

export function connection(value: unknown): CoreConnection {
  const snapshot = parseConnectionSnapshot(value)
  return handles.obtain(`connection:${snapshot.identity}`, () => new ConnectionHandle(snapshot))
}

export function session(value: unknown): CoreSession {
  const snapshot = parseSessionSnapshot(value)
  return handles.obtain(`session:${snapshot.identity}`, () => new SessionHandle(snapshot))
}

function connectionEvent(event: string, values: unknown[]) {
  if (event === "sessionChange") return values[0] === null ? null : session(values[0])
  if (event === "disconnect") return undefined
  return values[0]
}

function sessionEvent(identity: string, event: string, values: unknown[]) {
  if (event === "connectionAttach" || event === "connectionDetach") return connection(values[0])
  if (event === "end") return { reason: parseSessionEndSnapshot({ identity, valid: false, reason: values[0] }).reason }
  return values[0]
}
