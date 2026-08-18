import type { DesktopWallpaper, FileWallpaper, WallpaperLaunch } from "@phreshos/core"
import { programAddress, type Program } from "./domain.js"
import wire from "./wire.js"

class ServerFileWallpaper implements FileWallpaper {
  public constructor(private readonly surface: "sign-in" | "desktop") {}

  public async set(file: string) {
    await wire.request(["wallpaper", this.surface, "set", file])
  }

  public async remove() {
    await wire.request(["wallpaper", this.surface, "remove"])
  }
}

/** Authoritative sign-in wallpaper control available to Server endpoints. */
export class ServerSignInWallpaper extends ServerFileWallpaper {
  public constructor() { super("sign-in") }
}

/** Authoritative desktop wallpaper control available to Server endpoints. */
export class ServerDesktopWallpaper extends ServerFileWallpaper implements DesktopWallpaper {
  public constructor() { super("desktop") }

  public async setProgram(program: Program, launch: WallpaperLaunch = {}) {
    await wire.request(["wallpaper", "desktop", "set-program", programAddress(program), launch])
  }
}
