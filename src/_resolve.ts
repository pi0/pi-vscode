import { accessSync, constants } from "node:fs";
import { join } from "node:path";

export interface ResolveOptions {
  /** User-configured custom path */
  customPath?: string;
  /** Current platform (defaults to process.platform) */
  platform?: string;
  /** Home directory */
  home?: string;
  /** PATH environment variable */
  pathEnv?: string;
  /** %APPDATA% on Windows (defaults to process.env.APPDATA) */
  appData?: string;
  /** %LOCALAPPDATA% on Windows (defaults to process.env.LOCALAPPDATA) */
  localAppData?: string;
  /** Workspace root directories */
  workspaceDirs?: string[];
  /** File access check (defaults to fs.accessSync) */
  access?: (path: string, mode: number) => void;
}

export function resolvePiBinary(opts: ResolveOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const workspaceDirs = opts.workspaceDirs ?? [];
  const access = opts.access ?? accessSync;

  const isWin = platform === "win32";
  // On Windows, npm/pnpm create .cmd shims; also check .exe and .ps1
  const names = isWin ? ["pi.cmd", "pi.exe", "pi.ps1"] : ["pi"];
  // Windows lacks Unix-style execute permission; just check the file exists
  const accessFlag = isWin ? constants.F_OK : constants.X_OK;

  // If custom path provided, on Windows try .cmd/.exe/.ps1 variants when
  // the path has no recognised executable extension (extensionless npm shims
  // are bash scripts that Windows cannot spawn).
  if (opts.customPath) {
    if (isWin) {
      const resolved = resolveWindowsExecutable(opts.customPath, access);
      if (resolved) return resolved;
    }
    return opts.customPath;
  }

  // Check workspace-local node_modules/.bin first (respects monorepos / multi-root)
  const workspaceCandidates = workspaceDirs.flatMap((dir) =>
    names.map((n) => join(dir, "node_modules", ".bin", n)),
  );

  // Then well-known global paths
  const globalCandidates = isWin
    ? (() => {
        const appData = opts.appData ?? process.env.APPDATA ?? "";
        const localAppData = opts.localAppData ?? process.env.LOCALAPPDATA ?? "";
        const dirs: string[] = [];
        if (appData) dirs.push(join(appData, "npm"));
        if (localAppData) dirs.push(join(localAppData, "pnpm"));
        return dirs.flatMap((d) => names.map((n) => join(d, n)));
      })()
    : [`${home}/.bun/bin/pi`, `${home}/.local/bin/pi`, `${home}/.npm-global/bin/pi`];

  const candidates = [...workspaceCandidates, ...globalCandidates];
  for (const c of candidates) {
    try {
      access(c, accessFlag);
      return c;
    } catch {}
  }

  // Search OS PATH
  const pathDirs = pathEnv.split(isWin ? ";" : ":");
  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const n of names) {
      const full = join(dir, n);
      try {
        access(full, accessFlag);
        return full;
      } catch {}
    }
  }

  return "pi";
}

/**
 * On Windows, if a path has no recognised executable extension (.cmd/.exe/.ps1),
 * try appending each extension and return the first that exists on disk.
 * Returns null when the path already has a valid extension or no variant is found.
 */
function resolveWindowsExecutable(
  filePath: string,
  access: (path: string, mode: number) => void,
): string | null {
  const winExts = [".cmd", ".exe", ".ps1"];
  const dot = filePath.lastIndexOf(".");
  const sep = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  // Only treat as an extension if the dot is after the last path separator
  if (dot > sep && dot !== -1) {
    const ext = filePath.slice(dot).toLowerCase();
    if (winExts.includes(ext)) return null; // already has valid extension
  }

  for (const ext of winExts) {
    try {
      access(filePath + ext, constants.F_OK);
      return filePath + ext;
    } catch {}
  }
  return null;
}
