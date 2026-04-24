import * as vscode from "vscode";
import { TERMINAL_TITLE } from "./constants.ts";
import { createPiEnvironment, createPiShellArgs, ensurePiBinary } from "./pi.ts";

export async function createNewTerminal(options: {
  extensionUri: vscode.Uri;
  bridgeConfig?: { url: string; token: string };
  extraArgs?: string[];
  contextLines?: string[];
  terminalId?: string;
  sessionFile?: string;
}): Promise<vscode.Terminal | undefined> {
  const piPath = await ensurePiBinary();
  if (!piPath) return undefined;

  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const viewColumn = findPiColumn() ?? findUnusedColumn() ?? vscode.ViewColumn.Beside;
  const extraArgs = options.sessionFile
    ? ["--session", options.sessionFile, ...(options.extraArgs ?? [])]
    : options.extraArgs;
  const shellArgs = createPiShellArgs(options.extensionUri, {
    extraArgs,
    contextLines: options.contextLines,
  });

  const baseEnv = createPiEnvironment(options.bridgeConfig);
  const env = options.terminalId
    ? { ...baseEnv, PI_VSCODE_TERMINAL_ID: options.terminalId }
    : baseEnv;

  const terminal = vscode.window.createTerminal({
    name: TERMINAL_TITLE,
    shellPath: piPath,
    shellArgs: shellArgs.length > 0 ? shellArgs : undefined,
    location: { viewColumn },
    isTransient: true,
    cwd,
    env,
    iconPath: {
      light: vscode.Uri.joinPath(options.extensionUri, "assets", "logo-light.svg"),
      dark: vscode.Uri.joinPath(options.extensionUri, "assets", "logo.svg"),
    },
  });

  void vscode.commands.executeCommand("workbench.action.lockEditorGroup");
  return terminal;
}

export function buildOpenWithFileContext(): string[] {
  const lines: string[] = [];
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) lines.push(`The workspace root is: ${workspaceRoot}`);

  const editor = vscode.window.activeTextEditor;
  if (!editor) return lines;

  const fileName = editor.document.fileName;
  const selection = editor.selection;
  if (selection.isEmpty) {
    lines.push(`The user is currently viewing this file in their editor: ${fileName}`);
    lines.push(
      `The cursor is at line ${selection.active.line + 1}, character ${selection.active.character + 1}.`,
    );
    return lines;
  }

  lines.push(`The user is currently viewing this file in their editor: ${fileName}`);
  lines.push(
    `The current selection spans lines ${selection.start.line + 1}-${selection.end.line + 1}. Use the VS Code bridge to inspect the exact selected text if needed.`,
  );
  return lines;
}

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

function findUnusedColumn(): vscode.ViewColumn | undefined {
  const used = new Set<vscode.ViewColumn>();
  for (const group of vscode.window.tabGroups.all) {
    if (group.viewColumn !== undefined) used.add(group.viewColumn);
  }
  for (let column = vscode.ViewColumn.One; column <= vscode.ViewColumn.Nine; column++) {
    if (!used.has(column)) return column;
  }
  return undefined;
}
