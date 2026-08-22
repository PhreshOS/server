import { createThemeSnapshot, type ThemeProperties } from "@phreshos/core"
import Events from "./events.js"
import wire from "./wire.js"

/** System Theme authority reached explicitly through the server boundary. */
export default class ServerTheme extends Events {
  public constructor() {
    super(
      (event, listener, impossible) => wire.on("host-theme", event, value => {
        listener(createThemeSnapshot(value as ThemeProperties))
      }, null, impossible),
      observer => wire.onAll("host-theme", (event, value) => {
        if (typeof event === "string") observer(event, createThemeSnapshot(value as ThemeProperties))
      })
    )
  }

  public async snapshot() {
    const [theme] = await wire.request(["theme"]) as [ThemeProperties]
    return createThemeSnapshot(theme)
  }

  public readonly update = async (theme: ThemeProperties) => {
    await wire.request(["update-theme", theme])
  }
}
