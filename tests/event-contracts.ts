import { context, type ContextClient } from "../source/main.js"

context.client.lifecycle.subscribe("start", () => undefined)

context.client.subscribe("unknown", message => void message)
context.client.waitFor("unknown")
context.client.events("unknown")

function declaredClient(client: ContextClient<{ changed: number }>) {
  client.subscribe("changed", message => message.toFixed(0))
  client.waitFor("changed")
  client.events("changed")
  client.subscribe("unknown", message => void message)
}

void declaredClient

function closedClient(client: ContextClient<{}, never>) {
  // @ts-expect-error An explicitly closed Client rejects undeclared events.
  client.subscribe("unknown", () => undefined)
}

void closedClient
