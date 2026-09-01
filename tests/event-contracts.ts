import { context, type ContextClient } from "../source/main.js"

context.client.lifecycle.subscribe("start", () => undefined)

// @ts-expect-error The current Client has no undeclared application events.
context.client.subscribe("unknown", () => undefined)

// @ts-expect-error The current Client has no undeclared application events.
context.client.waitFor("unknown")

// @ts-expect-error The current Client has no undeclared application events.
context.client.events("unknown")

function declaredClient(client: ContextClient<{ changed: number }>) {
  client.subscribe("changed", message => message.toFixed(0))
  client.waitFor("changed")
  client.events("changed")
}

void declaredClient
