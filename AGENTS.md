# pi-vscode — VS Code Extension for Pi Coding Agent

**Always keep AGENTS.md updated with project status**.

## Architecture

- **Terminal-based**: Opens pi in a VS Code integrated terminal with full TUI/PTY support
- **Minimal**: Single source file (`src/extension.ts`), no framework dependencies

## Source Files

- `src/extension.ts` — Extension entry point: terminal lifecycle, commands, chat participant
- `dist/extension.cjs` — CJS wrapper for VS Code (loads ESM bundle via dynamic import)

## Build

- Source is ESM (`"type": "module"` in package.json)
- Bundled with rolldown → `dist/extension.cjs` (external: vscode)
- `dist/extension.cjs` is the CJS bundle output by rolldown (source is ESM, bundled to CJS)
- Tooling: `tsgo` (typecheck), `oxlint` + `oxfmt` (lint/format), `vitest` (tests)
- `pnpm build` / `pnpm dev` (watch) / `pnpm package`

## Icons

See [.agents/docs/icons.md](.agents/docs/icons.md)

## UI

- **Status bar button** (right-aligned) with `$(pi-logo) Pi` label — opens the pi terminal on click
- No sidebar or panel webviews — minimal footprint
- Activation: `onStartupFinished` so the status bar button appears immediately

## Commands

- `Pi: Open` (`Ctrl+Alt+3`) — Opens/focuses the pi terminal
- `Pi: Open with File` — Opens pi terminal and sends current file path (with selection range if any); also in editor title bar menu
- `Pi: Send Selection` — Sends editor selection text to the pi terminal
- `@pi` chat participant — Sends messages to the pi terminal via VS Code Chat

## Notes

- One pi terminal per window (reused if already open)
- Terminal cleaned up on close, recreated on next command
- CJS wrapper pattern allows `"type": "module"` while satisfying VS Code's `require()` loading
- Pi binary auto-detected from common paths (`~/.bun/bin/pi`, `~/.local/bin/pi`, etc.) or configurable via `pi-vscode.path` setting
- Terminal shell is the pi binary itself (not a shell running pi)
