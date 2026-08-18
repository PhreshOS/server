import { defaultTimeout } from "./events.js"

/** One SDK-owned deadline shared by every stage of an asynchronous operation. */
export default class Deadline {
  public readonly milliseconds: number
  private readonly expiresAt: number

  public constructor(milliseconds = defaultTimeout) {
    this.milliseconds = milliseconds
    this.expiresAt = Date.now() + milliseconds
  }

  public remaining() {
    return Math.max(0, this.expiresAt - Date.now())
  }
}
