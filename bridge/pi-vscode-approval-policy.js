export const READ_ONLY_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "vscode_get_editor_state",
  "vscode_get_selection",
  "vscode_get_latest_selection",
  "vscode_get_diagnostics",
  "vscode_get_open_editors",
  "vscode_get_workspace_folders",
  "vscode_get_document_symbols",
  "vscode_get_definitions",
  "vscode_get_type_definitions",
  "vscode_get_implementations",
  "vscode_get_declarations",
  "vscode_get_hover",
  "vscode_get_workspace_symbols",
  "vscode_get_references",
  "vscode_get_code_actions",
  "vscode_get_notifications",
  "vscode_check_document_dirty",
]);

export function requiresApproval(toolName) {
  return !READ_ONLY_TOOL_NAMES.has(toolName);
}
