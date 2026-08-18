import { createThemeSnapshot, type ThemeProperties } from "@phreshos/core"
import Events from "./events.js"
import wire from "./wire.js"

/** System Theme authority reached explicitly through the server boundary. */
export default class ServerTheme extends Events {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-theme", event, value => {
        if (isObject(value)) listener(createThemeSnapshot(value))
      }, null, impossible),
      observer => wire.onAll("host-theme", (event, value) => {
        if (typeof event === "string" && isObject(value)) observer(event, createThemeSnapshot(value))
      })
    )
  }

  public async snapshot() {
    const answer = await wire.request(["theme"]) as [ThemeProperties]
    if (!isObject(answer[0])) throw new Error("The host returned an invalid Theme snapshot")
    return createThemeSnapshot(answer[0])
  }

  public readonly update = async (theme: ThemeProperties) => {
    await wire.request(["update-theme", theme])
  }
}

function isObject(value: unknown): value is ThemeProperties {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const theme = value as Partial<ThemeProperties>
  return typeof theme.background === "string" && typeof theme.foreground === "string" && typeof theme.accent === "string"
    && typeof theme.spacing === "number" && typeof theme.radius === "number"
    && typeof theme.glass === "object" && theme.glass !== null
}
