import { constants } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiBinary } from "../src/_resolve.ts";

function mockAccess(existing: Set<string>) {
  return (path: string, _mode: number) => {
    if (!existing.has(path)) throw new Error("ENOENT");
  };
}

describe("resolvePiBinary", () => {
  it("returns custom path when configured", () => {
    expect(resolvePiBinary({ customPath: "/custom/pi" })).toBe("/custom/pi");
  });

  it("resolves custom path to .cmd on windows when extensionless", () => {
    const customPath = "C:\\nvm4w\\nodejs\\pi";
    const cmdPath = "C:\\nvm4w\\nodejs\\pi.cmd";
    const result = resolvePiBinary({
      customPath,
      platform: "win32",
      access: mockAccess(new Set([cmdPath])),
    });
    expect(result).toBe(cmdPath);
  });

  it("resolves custom path to .exe on windows when .cmd absent", () => {
    const customPath = "C:\\nvm4w\\nodejs\\pi";
    const exePath = "C:\\nvm4w\\nodejs\\pi.exe";
    const result = resolvePiBinary({
      customPath,
      platform: "win32",
      access: mockAccess(new Set([exePath])),
    });
    expect(result).toBe(exePath);
  });

  it("returns custom path as-is on windows when it already has .cmd extension", () => {
    const customPath = "C:\\nvm4w\\nodejs\\pi.cmd";
    const result = resolvePiBinary({
      customPath,
      platform: "win32",
      access: mockAccess(new Set()),
    });
    expect(result).toBe(customPath);
  });

  it("returns custom path as-is on windows when no variant found", () => {
    const customPath = "C:\\nvm4w\\nodejs\\pi";
    const result = resolvePiBinary({
      customPath,
      platform: "win32",
      access: mockAccess(new Set()),
    });
    expect(result).toBe(customPath);
  });

  it("returns custom path as-is on windows when it has any extension", () => {
    const customPath = "C:\\nvm4w\\nodejs\\pi.bat";
    const result = resolvePiBinary({
      customPath,
      platform: "win32",
      access: mockAccess(new Set()),
    });
    expect(result).toBe(customPath);
  });

  it("does not resolve custom path extensions on unix", () => {
    const customPath = "/usr/local/bin/pi";
    const result = resolvePiBinary({
      customPath,
      platform: "linux",
      access: mockAccess(new Set()),
    });
    expect(result).toBe(customPath);
  });

  it("finds pi in workspace node_modules/.bin on unix", () => {
    const wsDir = "/projects/myapp";
    const piPath = join(wsDir, "node_modules", ".bin", "pi");
    const result = resolvePiBinary({
      platform: "linux",
      workspaceDirs: [wsDir],
      access: mockAccess(new Set([piPath])),
      pathEnv: "",
    });
    expect(result).toBe(piPath);
  });

  it("finds pi.cmd in workspace node_modules/.bin on windows", () => {
    const wsDir = "C:\\Users\\dev\\project";
    const piCmd = join(wsDir, "node_modules", ".bin", "pi.cmd");
    const result = resolvePiBinary({
      platform: "win32",
      workspaceDirs: [wsDir],
      access: mockAccess(new Set([piCmd])),
      pathEnv: "",
    });
    expect(result).toBe(piCmd);
  });

  it("finds pi in well-known global paths on unix", () => {
    const home = "/home/user";
    const bunPath = `${home}/.bun/bin/pi`;
    const result = resolvePiBinary({
      platform: "linux",
      home,
      workspaceDirs: [],
      access: mockAccess(new Set([bunPath])),
      pathEnv: "",
    });
    expect(result).toBe(bunPath);
  });

  it("finds pi.cmd in APPDATA\\npm on windows", () => {
    const appData = "C:\\Users\\dev\\AppData\\Roaming";
    const piCmd = join(appData, "npm", "pi.cmd");
    const result = resolvePiBinary({
      platform: "win32",
      home: "C:\\Users\\dev",
      appData,
      localAppData: "",
      workspaceDirs: [],
      access: mockAccess(new Set([piCmd])),
      pathEnv: "",
    });
    expect(result).toBe(piCmd);
  });

  it("finds pi.cmd in LOCALAPPDATA\\pnpm on windows", () => {
    const localAppData = "C:\\Users\\dev\\AppData\\Local";
    const piCmd = join(localAppData, "pnpm", "pi.cmd");
    const result = resolvePiBinary({
      platform: "win32",
      home: "C:\\Users\\dev",
      appData: "",
      localAppData,
      workspaceDirs: [],
      access: mockAccess(new Set([piCmd])),
      pathEnv: "",
    });
    expect(result).toBe(piCmd);
  });

  it("falls back to 'pi' on windows when nothing found", () => {
    const result = resolvePiBinary({
      platform: "win32",
      home: "C:\\Users\\dev",
      appData: "",
      localAppData: "",
      workspaceDirs: [],
      access: mockAccess(new Set()),
      pathEnv: "",
    });
    expect(result).toBe("pi");
  });

  it("finds pi in PATH on unix", () => {
    const piPath = join("/usr/local/bin", "pi");
    const result = resolvePiBinary({
      platform: "linux",
      home: "/home/user",
      workspaceDirs: [],
      access: mockAccess(new Set([piPath])),
      pathEnv: "/usr/bin:/usr/local/bin",
    });
    expect(result).toBe(piPath);
  });

  it("finds pi.cmd in PATH on windows", () => {
    const piCmd = join("C:\\Users\\dev\\scoop\\apps\\nodejs\\current\\bin", "pi.cmd");
    const result = resolvePiBinary({
      platform: "win32",
      home: "C:\\Users\\dev",
      workspaceDirs: [],
      access: mockAccess(new Set([piCmd])),
      pathEnv: "C:\\Windows\\system32;C:\\Users\\dev\\scoop\\apps\\nodejs\\current\\bin",
    });
    expect(result).toBe(piCmd);
  });

  it("uses F_OK on windows, X_OK on unix", () => {
    const modes: number[] = [];
    const access = (path: string, mode: number) => {
      modes.push(mode);
      if (path.includes("pi")) return;
      throw new Error("ENOENT");
    };

    resolvePiBinary({
      platform: "win32",
      workspaceDirs: [],
      pathEnv: "C:\\bin",
      access,
    });
    expect(modes.every((m) => m === constants.F_OK)).toBe(true);

    modes.length = 0;
    resolvePiBinary({
      platform: "linux",
      workspaceDirs: [],
      pathEnv: "/usr/bin",
      access,
    });
    expect(modes.every((m) => m === constants.X_OK)).toBe(true);
  });

  it("falls back to 'pi' when nothing found", () => {
    const result = resolvePiBinary({
      platform: "linux",
      home: "/home/user",
      workspaceDirs: [],
      access: mockAccess(new Set()),
      pathEnv: "/usr/bin:/usr/local/bin",
    });
    expect(result).toBe("pi");
  });
});
