import type {
  Channel as CoreChannel,
  ChannelCapture as CoreChannelCapture,
  ChannelEvents as CoreChannelEvents,
  ChannelMessage as CoreChannelMessage,
  Cleanup
} from "@phreshos/core"
import { endpoint, type Endpoint, type EndpointReference } from "./domain.js"
import Events from "./events.js"
import wire from "./wire.js"
import { disableCurrentService, enableCurrentService } from "./service.js"

/** One value addressed to the current Server, with a server-visible sender. */
export type ChannelMessage<Payload = unknown> = CoreChannelMessage<Payload, Endpoint | null>

/** Handles one question addressed to the current Server. */
export type Answerer<Payload = unknown, Result = undefined> = (
  message: ChannelMessage<Payload>
) => Result | Promise<Result>

/** Applies the server-visible sender envelope to known Channel events. */
export type ChannelEvents<Events extends object> = CoreChannelEvents<Events, Endpoint | null>

/** Every event observable through the current Server's Channel. */
export type ChannelCapture<Events extends object = {}> = CoreChannelCapture<Events, Endpoint | null>

/** Events and questions explicitly accepted by the current Server. */
export interface Channel<Events extends object = {}> extends CoreChannel<Events, Endpoint | null> {
  /** Registers one answerer; omitting its return produces `undefined`. */
  answer<Payload = unknown, Result = undefined>(event: string, answerer: Answerer<Payload, Result>): Cleanup
}

class ServerChannel extends Events {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("end-end", event, value => listener(message(value)), null, impossible),
      observer => wire.onAll("end-end", (event, value) => {
        if (typeof event === "string") observer(event, message(value))
      })
    )
  }

  public publish(event: string, payload: unknown = undefined) {
    wire.send("end-host", "emit", event, payload)
  }

  public async enableService(name: string) { await enableCurrentService(name) }
  public async disableService() { await disableCurrentService() }

  public answer(event: string, answerer: Answerer): Cleanup {
    return wire.answer("end-end", event, value => answerer(message(value)))
  }
}

function message(value: unknown): ChannelMessage {
  const raw = value as { from?: EndpointReference | null, payload?: unknown }
  return { from: raw.from ? endpoint(raw.from) : null, payload: raw.payload }
}

export const channel = new ServerChannel() as unknown as Channel
