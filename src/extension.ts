import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { createPackagesViewProvider } from "./packages.ts";

const TERMINAL_TITLE = "PI Code";

let extensionUri: vscode.Uri;

export function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant("pi-vscode.chat", chatHandler);
  extensionUri = context.extensionUri;
  const logoIcon = {
    light: vscode.Uri.joinPath(extensionUri, "assets", "logo-light.svg"),
    dark: vscode.Uri.joinPath(extensionUri, "assets", "logo.svg"),
  };
  participant.iconPath = logoIcon;

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(pi-logo) Pi";
  statusBarItem.tooltip = "Open Pi Terminal";
  statusBarItem.command = "pi-vscode.open";
  statusBarItem.show();

  context.subscriptions.push(
    participant,
    statusBarItem,
    vscode.commands.registerCommand("pi-vscode.open", async () => {
      const t = await createNewTerminal();
      if (!t) return;
      t.show();
    }),
    vscode.commands.registerCommand("pi-vscode.openWithFile", async () => {
      const editor = vscode.window.activeTextEditor;
      const args: string[] = [];
      const parts: string[] = [];
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot)
        parts.push(
          `The workspace root is: ${workspaceRoot}\nUse this as the working directory for file operations and commands.`,
        );

      if (editor) {
        const doc = editor.document;
        const fileName = doc.fileName;
        const sel = editor.selection;

        if (!sel.isEmpty) {
          const startLine = sel.start.line + 1;
          const endLine = sel.end.line + 1;
          const selectedText = doc.getText(sel);
          parts.push(
            `The user is currently viewing ${fileName} (lines ${startLine}-${endLine}) in their editor:\n${selectedText}`,
          );
        } else {
          parts.push(`The user is currently viewing this file in their editor: ${fileName}`);
        }
      }

      if (parts.length > 0) {
        args.push("--append-system-prompt", parts.join("\n\n"));
      }
      const t = await createNewTerminal(args);
      if (!t) return;
      t.show();
    }),
    vscode.commands.registerCommand("pi-vscode.sendSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (selection) {
        const t = await createNewTerminal([selection]);
        if (!t) return;
        t.show();
      }
    }),
    vscode.commands.registerCommand("pi-vscode.openInNewWindow", async () => {
      const t = await createNewTerminal();
      if (!t) return;
      t.show();
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    }),
    vscode.window.registerWebviewViewProvider(
      "pi-vscode.packages",
      createPackagesViewProvider(findPiBinary),
    ),
    vscode.window.registerTerminalProfileProvider("pi-vscode.terminal-profile", {
      provideTerminalProfile() {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return new vscode.TerminalProfile({
          name: TERMINAL_TITLE,
          shellPath: findPiBinary(),
          cwd,
          iconPath: {
            light: vscode.Uri.joinPath(extensionUri, "assets", "logo-light.svg"),
            dark: vscode.Uri.joinPath(extensionUri, "assets", "logo.svg"),
          },
        });
      },
    }),
  );
}

export function deactivate() {
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === TERMINAL_TITLE) terminal.dispose();
  }
}

const chatHandler: vscode.ChatRequestHandler = async (request, _context, stream, _token) => {
  const message = request.prompt.trim();
  if (!message) {
    stream.markdown("Please provide a message to send to Pi.");
    return;
  }

  const t = await createNewTerminal([message]);
  if (!t) {
    stream.markdown(
      "Pi is not installed. Please install it with `npm i -g @mariozechner/pi-coding-agent`.",
    );
    return;
  }
  t.show();

  stream.markdown(
    `Sent to Pi terminal:\n\n\`\`\`\n${message}\n\`\`\`\n\nCheck the **Pi** terminal for the response.`,
  );
};

function findPiBinary(): string {
  const config = vscode.workspace.getConfiguration("pi-vscode");
  const custom = config.get<string>("path");
  if (custom) return custom;

  const home = process.env.HOME || process.env.USERPROFILE || "";
  const name = process.platform === "win32" ? "pi.exe" : "pi";

  // Check workspace-local node_modules/.bin first (respects monorepos / multi-root)
  const workspaceCandidates = (vscode.workspace.workspaceFolders ?? []).map((f) =>
    join(f.uri.fsPath, "node_modules", ".bin", name),
  );

  // Then well-known global paths
  const candidates = [
    ...workspaceCandidates,
    `${home}/.bun/bin/pi`,
    `${home}/.local/bin/pi`,
    `${home}/.npm-global/bin/pi`,
  ];
  for (const c of candidates) {
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch {}
  }

  // Search OS PATH
  const pathDirs = (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":");
  for (const dir of pathDirs) {
    if (!dir) continue;
    const full = join(dir, name);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {}
  }

  return "pi";
}

/** Find a column that already has a Pi terminal tab */
function findPiColumn(): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputTerminal && tab.label === TERMINAL_TITLE) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

/** Find the first editor column with no tabs */
function findUnusedColumn(): vscode.ViewColumn | undefined {
  const used = new Set<vscode.ViewColumn>();
  for (const group of vscode.window.tabGroups.all) {
    if (group.viewColumn !== undefined) used.add(group.viewColumn);
  }
  for (let col = vscode.ViewColumn.One; col <= vscode.ViewColumn.Nine; col++) {
    if (!used.has(col)) return col;
  }
  return undefined;
}

let piExistsCache: boolean | undefined;

async function createNewTerminal(args?: string[]): Promise<vscode.Terminal | undefined> {
  const piPath = findPiBinary();

  if (piExistsCache === undefined) {
    try {
      accessSync(piPath, constants.X_OK);
      piExistsCache = true;
    } catch {
      piExistsCache = false;
    }
  }

  if (!piExistsCache) {
    const commands: Record<string, string> = {
      npm: "npm i -g @mariozechner/pi-coding-agent",
      bun: "bun i -g @mariozechner/pi-coding-agent",
      pnpm: "pnpm i -g @mariozechner/pi-coding-agent",
    };
    const action = await vscode.window.showErrorMessage(
      "Pi binary not found. Install it globally?",
      ...Object.keys(commands),
    );
    if (action) {
      piExistsCache = undefined;
      const t = vscode.window.createTerminal({ name: "Install Pi" });
      t.show();
      t.sendText(commands[action]!);
    }
    return undefined;
  }

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Find a column that already has a Pi terminal, or use an unused one
  const viewColumn = findPiColumn() ?? findUnusedColumn() ?? vscode.ViewColumn.Beside;

  const terminal = vscode.window.createTerminal({
    name: TERMINAL_TITLE,
    shellPath: piPath,
    shellArgs: args && args.length > 0 ? args : undefined,
    location: { viewColumn },
    isTransient: true,
    cwd,
    iconPath: {
      light: vscode.Uri.joinPath(extensionUri, "assets", "logo-light.svg"),
      dark: vscode.Uri.joinPath(extensionUri, "assets", "logo.svg"),
    },
  });

  // Lock the editor group so Pi doesn't get displaced by file opens
  vscode.commands.executeCommand("workbench.action.lockEditorGroup");

  return terminal;
}
