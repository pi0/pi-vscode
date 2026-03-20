export const TERMINAL_TITLE = "PI Code";

export const BRIDGE_EXTENSION_PATH = "bridge/pi-vscode-bridge.js";

export const BRIDGE_BOOTSTRAP_LINES = [
  "You are running inside VS Code with a live IDE bridge.",
  "Prefer VS Code bridge tools over manual file reads or guesses: use them to get editor state, selection, diagnostics, symbols, definitions, hovers, references, code actions, workspace symbols, and open editors.",
  "After edits, check `vscode_get_diagnostics` for real-time type/lint errors from the IDE instead of running separate commands.",
];
