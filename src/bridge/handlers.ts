import * as vscode from "vscode";
import {
  captureSelection,
  captureSelectionStatus,
  getEditorInfo,
  getSelectionStatus,
  serializeCodeAction,
  serializeDiagnostic,
  serializeHover,
  serializeLocation,
  serializeLocationLike,
  serializePosition,
  serializeRange,
  serializeSymbol,
} from "./serialize.ts";
import type { BridgeDiagnosticSummary, BridgeEditorInfo, BridgeState } from "./types.ts";
import {
  createRange,
  getFileUri,
  getWorkspaceFolders,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readRequiredPosition,
  readRequiredString,
  readSelection,
  readWorkspaceEditEntries,
} from "./utils.ts";

export async function handleRpc(
  method: string,
  params: Record<string, unknown>,
  state: BridgeState,
): Promise<unknown> {
  switch (method) {
    case "getEditorState": {
      const activeEditor = vscode.window.activeTextEditor;
      return {
        workspaceFolders: getWorkspaceFolders(),
        activeEditor: activeEditor ? getEditorInfo(activeEditor) : undefined,
        currentSelection: captureSelection(activeEditor),
        latestSelection: state.latestSelection,
        openEditors: getOpenEditors(),
      };
    }
    case "getStatus":
      return getStatus(state);
    case "getCurrentSelection":
      return captureSelection(vscode.window.activeTextEditor) ?? state.latestSelection;
    case "getLatestSelection":
      return state.latestSelection;
    case "getDiagnostics":
      return getDiagnostics(readOptionalString(params.filePath));
    case "getOpenEditors":
      return getOpenEditors();
    case "getWorkspaceFolders":
      return getWorkspaceFolders();
    case "openFile":
      return openFile(params);
    case "checkDocumentDirty":
      return checkDocumentDirty(params);
    case "saveDocument":
      return saveDocument(params);
    case "getDocumentSymbols":
      return getDocumentSymbols(params);
    case "getDefinitions":
      return getDefinitions(params);
    case "getTypeDefinitions":
      return getTypeDefinitions(params);
    case "getImplementations":
      return getImplementations(params);
    case "getDeclarations":
      return getDeclarations(params);
    case "getHover":
      return getHover(params);
    case "getWorkspaceSymbols":
      return getWorkspaceSymbols(params);
    case "getReferences":
      return getReferences(params);
    case "getCodeActions":
      return getCodeActions(params, state);
    case "executeCodeAction":
      return executeCodeAction(params, state);
    case "applyWorkspaceEdit":
      return applyWorkspaceEdit(params);
    case "formatDocument":
      return formatDocument(params);
    case "formatRange":
      return formatRange(params);
    case "getNotifications":
      return getNotifications(params, state);
    case "clearNotifications":
      return clearNotifications(state);
    case "showNotification":
      return showNotification(params);
    case "reportTerminalSession":
      return reportTerminalSession(params, state);
    default:
      throw new Error(`Unknown bridge method: ${method}`);
  }
}

function reportTerminalSession(params: Record<string, unknown>, state: BridgeState) {
  const terminalId = readRequiredString(params.terminalId, "terminalId");
  const sessionFile = readRequiredString(params.sessionFile, "sessionFile");
  state.reportTerminalSession(terminalId, sessionFile);
  return { received: true };
}

function getStatus(state: BridgeState) {
  const activeEditor = vscode.window.activeTextEditor;
  const fallbackSelection = state.latestSelection;
  const fallbackUri = fallbackSelection ? vscode.Uri.parse(fallbackSelection.fileUri) : undefined;

  return {
    workspaceFolders: getWorkspaceFolders(),
    activeEditor: activeEditor
      ? getEditorInfo(activeEditor)
      : fallbackSelection
        ? getEditorInfoFromSelection(fallbackSelection)
        : undefined,
    selection: activeEditor
      ? captureSelectionStatus(activeEditor)
      : fallbackSelection
        ? getSelectionStatus(fallbackSelection)
        : undefined,
    diagnostics: activeEditor
      ? getDiagnosticSummary(vscode.languages.getDiagnostics(activeEditor.document.uri))
      : fallbackUri
        ? getDiagnosticSummary(vscode.languages.getDiagnostics(fallbackUri))
        : getDiagnosticSummary([]),
  };
}

function getEditorInfoFromSelection(selection: BridgeState["latestSelection"]): BridgeEditorInfo {
  const openDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === selection?.fileUri,
  );
  return {
    filePath: selection?.filePath ?? "",
    fileUri: selection?.fileUri ?? "",
    languageId: openDocument?.languageId ?? selection?.languageId ?? "",
    isDirty: openDocument?.isDirty ?? false,
    isActive: false,
  };
}

function getDiagnosticSummary(diagnostics: readonly vscode.Diagnostic[]): BridgeDiagnosticSummary {
  const summary = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const diagnostic of diagnostics) {
    switch (diagnostic.severity) {
      case vscode.DiagnosticSeverity.Error:
        summary.errors++;
        break;
      case vscode.DiagnosticSeverity.Warning:
        summary.warnings++;
        break;
      case vscode.DiagnosticSeverity.Information:
        summary.infos++;
        break;
      case vscode.DiagnosticSeverity.Hint:
        summary.hints++;
        break;
    }
  }
  return summary;
}

function getOpenEditors() {
  const seen = new Map<string, ReturnType<typeof getEditorInfo>>();
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme !== "file") continue;
    seen.set(editor.document.uri.toString(), getEditorInfo(editor));
  }
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== "file") continue;
    if (seen.has(document.uri.toString())) continue;
    seen.set(document.uri.toString(), {
      filePath: document.uri.fsPath,
      fileUri: document.uri.toString(),
      languageId: document.languageId,
      isDirty: document.isDirty,
      isActive: vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString(),
    });
  }
  return [...seen.values()];
}

function getDiagnostics(filePath?: string) {
  const entries = filePath
    ? [[getFileUri(filePath), vscode.languages.getDiagnostics(getFileUri(filePath))] as const]
    : vscode.languages.getDiagnostics();

  return entries.map(([uri, diagnostics]) => ({
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    diagnostics: diagnostics.map((diagnostic) => serializeDiagnostic(diagnostic)),
  }));
}

async function openFile(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: readOptionalBoolean(params.preview) ?? false,
    preserveFocus: readOptionalBoolean(params.preserveFocus) ?? false,
  });

  const selection = readSelection(params.selection);
  if (selection) {
    const range = new vscode.Range(selection.start, selection.end);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  return {
    opened: true,
    filePath: document.uri.fsPath,
    fileUri: document.uri.toString(),
    selection: captureSelection(editor),
  };
}

function checkDocumentDirty(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const document = vscode.workspace.textDocuments.find(
    (entry) => entry.uri.toString() === uri.toString(),
  );
  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    isOpen: !!document,
    isDirty: document?.isDirty ?? false,
  };
}

async function saveDocument(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const document =
    vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString()) ??
    (await vscode.workspace.openTextDocument(uri));
  return {
    filePath: document.uri.fsPath,
    fileUri: document.uri.toString(),
    wasDirty: document.isDirty,
    saved: await document.save(),
    isDirty: document.isDirty,
  };
}

async function getDocumentSymbols(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const result = await vscode.commands.executeCommand<
    vscode.DocumentSymbol[] | vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", uri);
  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    symbols: (result ?? []).map((symbol) => serializeSymbol(symbol)),
  };
}

async function getDefinitions(params: Record<string, unknown>) {
  return getLocationResults(params, "vscode.executeDefinitionProvider", "definitions");
}

async function getTypeDefinitions(params: Record<string, unknown>) {
  return getLocationResults(params, "vscode.executeTypeDefinitionProvider", "typeDefinitions");
}

async function getImplementations(params: Record<string, unknown>) {
  return getLocationResults(params, "vscode.executeImplementationProvider", "implementations");
}

async function getDeclarations(params: Record<string, unknown>) {
  return getLocationResults(params, "vscode.executeDeclarationProvider", "declarations");
}

async function getHover(params: Record<string, unknown>) {
  const filePath = readRequiredString(params.filePath, "filePath");
  const position = readRequiredPosition(params.position, "position");
  const uri = getFileUri(filePath);
  const result = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    uri,
    position,
  );
  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    position: serializePosition(position),
    hovers: (result ?? []).map((hover) => serializeHover(hover)),
  };
}

async function getWorkspaceSymbols(params: Record<string, unknown>) {
  const query = readRequiredString(params.query, "query");
  const result = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query,
  );
  return {
    query,
    symbols: (result ?? []).map((symbol) => serializeSymbol(symbol)),
  };
}

async function getReferences(params: Record<string, unknown>) {
  const filePath = readRequiredString(params.filePath, "filePath");
  const position = readRequiredPosition(params.position, "position");
  const uri = getFileUri(filePath);
  const result = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeReferenceProvider",
    uri,
    position,
  );
  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    position: serializePosition(position),
    references: (result ?? []).map((location) => serializeLocation(location)),
  };
}

async function getLocationResults(
  params: Record<string, unknown>,
  command: string,
  resultKey: string,
) {
  const filePath = readRequiredString(params.filePath, "filePath");
  const position = readRequiredPosition(params.position, "position");
  const uri = getFileUri(filePath);
  const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    command,
    uri,
    position,
  );
  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    position: serializePosition(position),
    [resultKey]: (result ?? []).map((location) => serializeLocationLike(location)),
  };
}

async function getCodeActions(params: Record<string, unknown>, state: BridgeState) {
  const filePath = readRequiredString(params.filePath, "filePath");
  const uri = getFileUri(filePath);
  const selection = readSelection(params.selection);
  const range = selection
    ? new vscode.Range(selection.start, selection.end)
    : new vscode.Range(
        readRequiredPosition(params.start, "start"),
        readRequiredPosition(params.end, "end"),
      );
  const diagnostics = vscode.languages
    .getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.range.intersection(range));
  const result = await vscode.commands.executeCommand<(vscode.Command | vscode.CodeAction)[]>(
    "vscode.executeCodeActionProvider",
    uri,
    range,
  );
  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    range: serializeRange(range),
    diagnostics: diagnostics.map((diagnostic) => serializeDiagnostic(diagnostic)),
    actions: (result ?? []).map((action) =>
      serializeCodeAction(action, state.cacheCodeAction(action, filePath)),
    ),
  };
}

async function executeCodeAction(params: Record<string, unknown>, state: BridgeState) {
  const actionId = readRequiredString(params.actionId, "actionId");
  const cached = state.codeActions.get(actionId);
  if (!cached) throw new Error(`Unknown or expired code action id: ${actionId}`);

  const { action } = cached;
  let editApplied = false;
  let commandExecuted = false;

  if (action instanceof vscode.CodeAction) {
    if (action.edit) editApplied = await vscode.workspace.applyEdit(action.edit);
    if (action.command) {
      await vscode.commands.executeCommand(
        action.command.command,
        ...(action.command.arguments ?? []),
      );
      commandExecuted = true;
    }
  } else {
    await vscode.commands.executeCommand(action.command, ...(action.arguments ?? []));
    commandExecuted = true;
  }

  state.codeActions.delete(actionId);
  return {
    actionId,
    filePath: cached.filePath,
    title: action.title,
    editApplied,
    commandExecuted,
  };
}

async function applyWorkspaceEdit(params: Record<string, unknown>) {
  const edits = readWorkspaceEditEntries(params.edits);
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.replace(getFileUri(edit.filePath), createRange(edit.range), edit.newText);
  }
  return {
    applied: await vscode.workspace.applyEdit(workspaceEdit),
    edits: edits.map((edit) => ({ filePath: getFileUri(edit.filePath).fsPath, range: edit.range })),
  };
}

async function formatDocument(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const options = (await getFormattingOptions(uri)) ?? {};
  const result =
    (await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      uri,
      options,
    )) ?? [];

  return applyFormattingEdits(uri, result);
}

async function formatRange(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const selection = readSelection(params.selection);
  const range = selection
    ? new vscode.Range(selection.start, selection.end)
    : new vscode.Range(
        readRequiredPosition(params.start, "start"),
        readRequiredPosition(params.end, "end"),
      );
  const options = (await getFormattingOptions(uri)) ?? {};
  const result =
    (await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatRangeProvider",
      uri,
      range,
      options,
    )) ?? [];

  return applyFormattingEdits(uri, result, range);
}

function getNotifications(params: Record<string, unknown>, state: BridgeState) {
  const since = readOptionalNumber(params.since);
  const limit = Math.max(1, Math.min(readOptionalNumber(params.limit) ?? 20, 100));
  const notifications = state.notifications.filter((entry) =>
    since ? entry.timestamp > since : true,
  );
  return {
    notifications: notifications.slice(-limit),
    latestTimestamp: state.notifications.at(-1)?.timestamp,
  };
}

function clearNotifications(state: BridgeState) {
  const cleared = state.notifications.length;
  state.notifications.length = 0;
  return { cleared };
}

async function showNotification(params: Record<string, unknown>) {
  const message = readRequiredString(params.message, "message");
  const type = readOptionalString(params.type) ?? "info";
  const modal = readOptionalBoolean(params.modal) ?? false;

  switch (type) {
    case "info":
      await vscode.window.showInformationMessage(message, { modal });
      break;
    case "warning":
      await vscode.window.showWarningMessage(message, { modal });
      break;
    case "error":
      await vscode.window.showErrorMessage(message, { modal });
      break;
    default:
      throw new Error(`Invalid notification type: ${type}`);
  }

  return { shown: true, type, modal, message };
}

async function getFormattingOptions(uri: vscode.Uri) {
  const document =
    vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString()) ??
    (await vscode.workspace.openTextDocument(uri));

  return {
    insertSpaces: getEditorInsertSpaces(document),
    tabSize: getEditorTabSize(document),
  };
}

async function applyFormattingEdits(
  uri: vscode.Uri,
  edits: vscode.TextEdit[],
  range?: vscode.Range,
) {
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) workspaceEdit.replace(uri, edit.range, edit.newText);

  return {
    filePath: uri.fsPath,
    fileUri: uri.toString(),
    range: range ? serializeRange(range) : undefined,
    editCount: edits.length,
    edits: edits.map((edit) => ({ range: serializeRange(edit.range), newText: edit.newText })),
    applied: edits.length > 0 ? await vscode.workspace.applyEdit(workspaceEdit) : true,
  };
}

function getEditorInsertSpaces(document: vscode.TextDocument) {
  return vscode.workspace.getConfiguration("editor", document).get<boolean>("insertSpaces") ?? true;
}

function getEditorTabSize(document: vscode.TextDocument) {
  return vscode.workspace.getConfiguration("editor", document).get<number>("tabSize") ?? 2;
}
