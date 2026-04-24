# pi-vscode — VS Code Extension for Pi Coding Agent

**Always keep AGENTS.md updated with project status**.

## Architecture

- **Terminal-based**: Opens pi in a VS Code integrated terminal with full TUI/PTY support
- **Local IDE bridge**: VS Code starts a localhost HTTP bridge with an auth token and injects it into each pi terminal via env vars
- **Bundled pi extension**: `bridge/pi-vscode-bridge.js` is passed to pi via `--extension` so the agent can call back into VS Code as custom tools
- **Minimal**: Small TypeScript extension host plus one bundled pi bridge script, no framework dependencies

## Source Files

- `src/extension.ts` — Thin activation/wiring layer for commands, status bar, terminal profile, chat participant, and bridge lifecycle
- `src/pi.ts` — Pi binary resolution, install prompt, launch args, bridge env helpers
- `src/terminal.ts` — Terminal creation, terminal placement, open-with-file context helpers
- `src/chat.ts` — RPC-backed `@pi` chat handler with terminal fallback
- `src/bridge/server.ts` — HTTP server setup, auth, request parsing, VS Code event subscriptions
- `src/bridge/handlers.ts` — RPC method handlers for editor state, diagnostics, symbols, definitions/declarations/implementations, hovers, references, workspace symbol search, code actions, formatting, and edits
- `src/bridge/serialize.ts` — Selection/editor/diagnostic/symbol/code-action serialization helpers
- `src/bridge/state.ts` — Bridge notification and code-action cache state
- `src/bridge/types.ts` — Bridge type definitions (selection, editor info, notifications, RPC, state)
- `src/bridge/utils.ts` — Path resolution, request parsing, range helpers
- `bridge/pi-vscode-bridge.js` — Bundled pi extension registering VS Code bridge tools for pi
- `dist/extension.cjs` — CJS wrapper for VS Code (loads ESM bundle via dynamic import)

## Build

- Source is ESM (`"type": "module"` in package.json)
- Bundled with rolldown → `dist/extension.cjs` (external: vscode)
- `dist/extension.cjs` is the CJS bundle output by rolldown (source is ESM, bundled to CJS)
- Tooling: `tsgo` (typecheck), `oxlint` + `oxfmt` (lint/format), `vitest` (tests)
- `pnpm build` / `pnpm dev` (watch) / `pnpm package`
- `rolldown.config.ts` should not use unsupported `output.clean`; keep output config minimal to avoid build warnings

## Pre-commit Checks

After finalizing changes, always run both:

- `pnpm fmt` — auto-fix lint and formatting
- `pnpm typecheck` — ensure no type errors

## Icons

See [.agents/docs/icons.md](.agents/docs/icons.md)

## UI

- **Status bar button** (right-aligned) with `$(pi-logo) Pi` label — opens the pi terminal on click
- **Packages sidebar view** includes search/install/uninstall package management and an `Upgrade Pi and Packages` button wired to `Pi: Upgrade Pi and Packages`
- No panel webviews — minimal footprint
- Activation: `onStartupFinished` so the status bar button appears immediately

## Commands

- `Pi: Open` (`Ctrl+Alt+3`) — Opens/focuses the pi terminal
- `Pi: Open with File` — Opens pi terminal and sends current file path (with selection range if any); also in editor title bar menu
- `Pi: Send Selection` — Sends editor selection text to the pi terminal
- `Pi: Upgrade Pi and Packages` — Finds the resolved pi binary, infers npm/bun/pnpm/yarn from its path (prompting if ambiguous), runs the matching global install/update command in a terminal, then runs `pi update` to update installed pi extensions/packages
- `@pi` chat participant — Uses pi RPC mode for streamed chat responses while preserving the terminal-based workflow for normal Pi commands

## Notes

- One pi terminal profile per window; new launches reuse the same title and colocate beside the editor
- Terminal cleaned up on close, recreated on next command
- CJS wrapper pattern allows `"type": "module"` while satisfying VS Code's `require()` loading
- Pi binary auto-detected from common paths (`~/.bun/bin/pi`, `~/.local/bin/pi`, etc.) or configurable via `pi-vscode.path` setting
- `Pi: Upgrade Pi and Packages` reuses the binary resolver, guesses the package manager from the discovered binary path, launches the corresponding global install command for `@mariozechner/pi-coding-agent@latest`, and chains `pi update` afterward
- Terminal shell is the pi binary itself (not a shell running pi)
- Every pi launch injects `PI_VSCODE_BRIDGE_URL` and `PI_VSCODE_BRIDGE_TOKEN` plus `--extension bridge/pi-vscode-bridge.js`
- Bridge tool coverage currently includes: current selection, latest cached selection, diagnostics, open editors, workspace folders, aggregate editor state, opening files in VS Code, dirty/save state, document symbols, definitions, type definitions, implementations, declarations, hover info, workspace symbol search, references, code actions, executing code actions, applying workspace edits, document/range formatting through VS Code providers, buffered IDE notifications, and showing VS Code info/warning/error notifications
- Formatting bridge methods (`formatDocument`, `formatRange`) call `vscode.executeFormatDocumentProvider` / `vscode.executeFormatRangeProvider`, convert the returned `TextEdit[]` into a `WorkspaceEdit`, and apply it with `workspace.applyEdit`
- Bridge notifications now reset dirty state on save, refresh latest selection on active-editor switches, and mark mutating VS Code bridge tools as sequential to reduce parallel edit races
- The bundled pi bridge truncates oversized JSON tool results into a valid wrapper object, and VS Code chat RPC auto-cancels unsupported extension UI dialog requests so RPC sessions do not deadlock
- README bridge docs now group tools into inspection vs action categories, include formatting tools and `vscode_show_notification`, and document important parameter/behavior notes (`selection` vs `start`/`end`, notification polling, cached code action ids)

## Bridge TODO

- [x] 1. Add `checkDocumentDirty` and `saveDocument` bridge methods and pi tools
- [x] 2. Add symbol/reference/code-action bridge methods and pi tools
- [x] 3. Add buffered bridge notifications for selection/diagnostics/editor/save state changes plus tools to read/clear them
- [x] 4. Add apply-workspace-edit / quick-fix execution support
- [x] 5. Add an RPC-driven chat participant path while preserving the terminal workflow for direct Pi usage
- [ ] 6. Consider a richer webview/session UI backed by the same RPC bridge
