import * as vscode from "vscode";
import type { BridgeEditorInfo, BridgeSelection } from "./types.ts";

type LocationLike = vscode.Location | vscode.LocationLink;

export const IGNORE_SELECTION_SCHEMES = new Set(["comment", "output"]);

export function captureSelection(
  editor: vscode.TextEditor | undefined,
): BridgeSelection | undefined {
  if (!editor) return undefined;
  const { document, selection } = editor;
  if (IGNORE_SELECTION_SCHEMES.has(document.uri.scheme)) return undefined;
  return {
    text: document.getText(selection),
    isEmpty: selection.isEmpty,
    filePath: document.uri.fsPath,
    fileUri: document.uri.toString(),
    languageId: document.languageId,
    start: serializePosition(selection.start),
    end: serializePosition(selection.end),
  };
}

export function getEditorInfo(editor: vscode.TextEditor): BridgeEditorInfo {
  return {
    filePath: editor.document.uri.fsPath,
    fileUri: editor.document.uri.toString(),
    languageId: editor.document.languageId,
    isDirty: editor.document.isDirty,
    viewColumn: editor.viewColumn,
    isActive:
      vscode.window.activeTextEditor?.document.uri.toString() === editor.document.uri.toString(),
  };
}

export function serializePosition(position: { line: number; character: number }) {
  return { line: position.line, character: position.character };
}

export function serializeRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}) {
  return {
    start: serializePosition(range.start),
    end: serializePosition(range.end),
  };
}

export function serializeLocation(location: vscode.Location) {
  return {
    filePath: location.uri.fsPath,
    fileUri: location.uri.toString(),
    range: serializeRange(location.range),
  };
}

export function serializeLocationLike(location: LocationLike) {
  if (location instanceof vscode.Location) return serializeLocation(location);
  return {
    filePath: location.targetUri.fsPath,
    fileUri: location.targetUri.toString(),
    range: serializeRange(location.targetRange),
    targetSelectionRange: location.targetSelectionRange
      ? serializeRange(location.targetSelectionRange)
      : undefined,
    originSelectionRange: location.originSelectionRange
      ? serializeRange(location.originSelectionRange)
      : undefined,
  };
}

export function serializeDiagnostic(diagnostic: vscode.Diagnostic) {
  return {
    severity: diagnostic.severity,
    severityLabel: diagnosticSeverityToString(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source,
    code: diagnostic.code,
    range: serializeRange(diagnostic.range),
    relatedInformation: diagnostic.relatedInformation?.map((info) => ({
      message: info.message,
      filePath: info.location.uri.fsPath,
      fileUri: info.location.uri.toString(),
      range: serializeRange(info.location.range),
    })),
  };
}

export function serializeSymbol(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): unknown {
  if (symbol instanceof vscode.DocumentSymbol) {
    return {
      name: symbol.name,
      detail: symbol.detail,
      kind: vscode.SymbolKind[symbol.kind],
      tags: symbol.tags,
      range: serializeRange(symbol.range),
      selectionRange: serializeRange(symbol.selectionRange),
      children: symbol.children.map((child) => serializeSymbol(child)),
    };
  }
  return {
    name: symbol.name,
    containerName: symbol.containerName,
    kind: vscode.SymbolKind[symbol.kind],
    tags: symbol.tags,
    location: serializeLocation(symbol.location),
  };
}

export function serializeCommand(command: vscode.Command) {
  return {
    title: command.title,
    command: command.command,
    tooltip: command.tooltip,
    argumentCount: command.arguments?.length ?? 0,
  };
}

export function serializeCodeAction(action: vscode.Command | vscode.CodeAction, actionId: string) {
  if (!(action instanceof vscode.CodeAction)) {
    return {
      id: actionId,
      kind: "command",
      command: serializeCommand(action),
    };
  }
  return {
    id: actionId,
    kind: "codeAction",
    title: action.title,
    disabled: action.disabled,
    isPreferred: action.isPreferred,
    kindLabel: action.kind?.value,
    diagnostics: action.diagnostics?.map((diagnostic) => serializeDiagnostic(diagnostic)),
    command: action.command ? serializeCommand(action.command) : undefined,
    hasEdit: !!action.edit,
  };
}

export function serializeHover(hover: vscode.Hover) {
  return {
    contents: hover.contents.map((content) => {
      if (typeof content === "string") return { kind: "markdown", value: content };
      if (content instanceof vscode.MarkdownString) {
        return {
          kind: "markdown",
          value: content.value,
          isTrusted: content.isTrusted,
          supportHtml: content.supportHtml,
          supportThemeIcons: content.supportThemeIcons,
        };
      }
      return {
        kind: "codeblock",
        language: content.language,
        value: content.value,
      };
    }),
    range: hover.range ? serializeRange(hover.range) : undefined,
  };
}

function diagnosticSeverityToString(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "information";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
  }
}
