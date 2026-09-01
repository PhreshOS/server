import type { System as CoreSystem } from "@phreshos/core"
import { system } from "../source/main.js"

declare const canonical: CoreSystem

const shared: CoreSystem = system
const attached: typeof system = canonical

void shared
void attached
