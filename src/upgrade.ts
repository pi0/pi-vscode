export const PI_PACKAGE_NAME = "@mariozechner/pi-coding-agent";

export type PiPackageManager = "bun" | "npm" | "pnpm" | "yarn";

export const PI_PACKAGE_MANAGERS: readonly PiPackageManager[] = ["npm", "bun", "pnpm", "yarn"];

export function guessPiPackageManager(piPath: string): PiPackageManager | undefined {
  const normalized = piPath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const hasSegment = (segment: string) => segments.includes(segment);
  const includesPath = (path: string) => normalized.includes(path);

  if (includesPath("/.bun/") || hasSegment("bun")) return "bun";

  if (
    includesPath("/.local/share/pnpm/") ||
    includesPath("/appdata/local/pnpm/") ||
    hasSegment("pnpm") ||
    hasSegment("pnpm-global")
  ) {
    return "pnpm";
  }

  if (includesPath("/.yarn/") || hasSegment("yarn")) return "yarn";

  if (
    includesPath("/.npm-global/") ||
    includesPath("/appdata/roaming/npm/") ||
    hasSegment("npm") ||
    hasSegment("npm-global") ||
    hasSegment("node") ||
    hasSegment("nodejs") ||
    hasSegment(".nvm") ||
    hasSegment(".nodenv") ||
    hasSegment(".asdf") ||
    hasSegment("nvs")
  ) {
    return "npm";
  }

  return undefined;
}

export function createPiGlobalInstallCommand(manager: PiPackageManager): string {
  const pkg = `${PI_PACKAGE_NAME}@latest`;
  switch (manager) {
    case "bun":
      return `bun install --global ${pkg}`;
    case "npm":
      return `npm install --global ${pkg}`;
    case "pnpm":
      return `pnpm add --global ${pkg}`;
    case "yarn":
      return `yarn global add ${pkg}`;
  }
}

export function createPiUpgradeCommand(
  manager: PiPackageManager,
  piPath: string,
  platform = process.platform,
): string {
  return `${createPiGlobalInstallCommand(manager)} && ${createPiUpdateCommand(piPath, platform)}`;
}

function createPiUpdateCommand(piPath: string, platform: string): string {
  return `${quoteCommandPath(piPath, platform)} update`;
}

function quoteCommandPath(commandPath: string, platform: string): string {
  if (/^[\w./:@%+-]+$/.test(commandPath)) return commandPath;
  if (platform === "win32") return `"${commandPath.replaceAll('"', '""')}"`;
  return `'${commandPath.replaceAll("'", "'\\''")}'`;
}
