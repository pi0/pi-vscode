import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeState } from "../src/bridge/types.ts";

const vscode = vi.hoisted(() => ({ showWarningMessage: vi.fn() }));

vi.mock("vscode", () => ({ window: vscode }));

import { createApprovalBroker } from "../src/bridge/approvals.ts";

const state = { codeActions: new Map() } as unknown as BridgeState;

describe("approval broker", () => {
  beforeEach(() => {
    vscode.showWarningMessage.mockReset();
  });

  it("shows the command and only accepts Allow Once", async () => {
    vscode.showWarningMessage.mockResolvedValueOnce("Allow Once");

    const result = await createApprovalBroker().request(
      { toolName: "bash", input: { command: "pnpm test" } },
      state,
    );

    expect(result).toEqual({ approved: true });
    expect(vscode.showWarningMessage).toHaveBeenCalledWith(
      "Pi wants to run “bash”.",
      expect.objectContaining({
        modal: true,
        detail: "Command:\npnpm test",
      }),
      "Allow Once",
      "Deny",
    );
  });

  it("serializes simultaneous approval requests", async () => {
    let resolveFirst: ((value: string) => void) | undefined;
    vscode.showWarningMessage
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("Deny");

    const broker = createApprovalBroker();
    const first = broker.request({ toolName: "bash", input: { command: "first" } }, state);
    const second = broker.request({ toolName: "write", input: { path: "second" } }, state);

    await Promise.resolve();
    expect(vscode.showWarningMessage).toHaveBeenCalledTimes(1);

    resolveFirst?.("Allow Once");
    await expect(first).resolves.toEqual({ approved: true });
    await expect(second).resolves.toEqual({ approved: false });
    expect(vscode.showWarningMessage).toHaveBeenCalledTimes(2);
  });
});
