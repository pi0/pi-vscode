import { describe, expect, it } from "vitest";
import { requiresApproval } from "../bridge/pi-vscode-approval-policy.js";

describe("requiresApproval", () => {
  it("does not prompt for explicit inspection tools", () => {
    expect(requiresApproval("read")).toBe(false);
    expect(requiresApproval("vscode_get_diagnostics")).toBe(false);
  });

  it("prompts for mutation-capable built-ins and bridge actions", () => {
    expect(requiresApproval("bash")).toBe(true);
    expect(requiresApproval("edit")).toBe(true);
    expect(requiresApproval("write")).toBe(true);
    expect(requiresApproval("vscode_apply_workspace_edit")).toBe(true);
  });

  it("fails closed for tools added after the allowlist", () => {
    expect(requiresApproval("unrecognized_extension_tool")).toBe(true);
  });
});
