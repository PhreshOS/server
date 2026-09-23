import type { Connection, ExecuteOperationSummary, Session, System as CoreSystem } from "@phreshos/core"
import { system } from "../source/main.js"

declare const canonical: CoreSystem

const shared: CoreSystem = system
const attached: typeof system = canonical
const connections: Promise<Connection[]> = system.authentication.connections()
const sessions: Promise<Session[]> = system.authentication.sessions()
const execution: Promise<ExecuteOperationSummary[]> = system.execute({ $domain: "operation", $operation: "list" })

void [shared, attached, connections, sessions, execution]
