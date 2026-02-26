import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

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
    vscode.commands.registerCommand("pi-vscode.open", () => {
      const t = createNewTerminal();
      t.show();
    }),
    vscode.commands.registerCommand("pi-vscode.openWithFile", () => {
      const editor = vscode.window.activeTextEditor;
      const t = createNewTerminal();
      t.show();
      if (editor) {
        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const sel = editor.selection;
        const range = sel.isEmpty
          ? `#L${sel.active.line + 1}`
          : `#L${sel.start.line + 1}-${sel.end.line + 1}`;
        const prompt = `In @${filePath}${range}`;
        const sendPrompt = () => {
          t.sendText("\x15", false);
          t.sendText(prompt, false);
        };
        t.processId.then(() => sendPrompt());
      }
    }),
    vscode.commands.registerCommand("pi-vscode.sendSelection", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (selection) {
        const t = createNewTerminal();
        t.sendText(selection);
        t.show();
      }
    }),
    vscode.window.registerTerminalProfileProvider("pi-vscode.terminal-profile", {
      provideTerminalProfile() {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return new vscode.TerminalProfile({
          name: "Pi",
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

export function deactivate() {}

const chatHandler: vscode.ChatRequestHandler = async (request, _context, stream, _token) => {
  const message = request.prompt.trim();
  if (!message) {
    stream.markdown("Please provide a message to send to Pi.");
    return;
  }

  const t = createNewTerminal();
  t.sendText(message);
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

  // Check well-known paths first
  const candidates = [`${home}/.bun/bin/pi`, `${home}/.local/bin/pi`, `${home}/.npm-global/bin/pi`];
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

function createNewTerminal(): vscode.Terminal {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const terminal = vscode.window.createTerminal({
    name: "Pi",
    shellPath: findPiBinary(),
    cwd,
    iconPath: {
      light: vscode.Uri.joinPath(extensionUri, "assets", "logo-light.svg"),
      dark: vscode.Uri.joinPath(extensionUri, "assets", "logo.svg"),
    },
    location: {
      viewColumn: vscode.ViewColumn.Beside,
    },
  });

  return terminal;
}
