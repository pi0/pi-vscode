import * as vscode from "vscode";
import type { BridgeState } from "./types.ts";
import { readRequiredString } from "./utils.ts";

const MAX_DETAIL_LENGTH = 12_000;

export interface ApprovalBroker {
  request(params: Record<string, unknown>, state: BridgeState): Promise<{ approved: boolean }>;
}

export function createApprovalBroker(): ApprovalBroker {
  let queue = Promise.resolve();

  return {
    async request(params, state) {
      const toolName = readRequiredString(params.toolName, "toolName");
      const input = readToolInput(params.input);
      const approval = queue.then(() => showApproval(toolName, input, state));
      queue = approval.then(
        () => undefined,
        () => undefined,
      );
      return approval;
    },
  };
}

function readToolInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function showApproval(
  toolName: string,
  input: Record<string, unknown>,
  state: BridgeState,
): Promise<{ approved: boolean }> {
  const choice = await vscode.window.showWarningMessage(
    `Pi wants to run ${formatToolName(toolName)}.`,
    {
      modal: true,
      detail: getApprovalDetail(toolName, input, state),
    },
    "Allow Once",
    "Deny",
  );
  return { approved: choice === "Allow Once" };
}

function formatToolName(toolName: string): string {
  return `“${toolName}”`;
}

function getApprovalDetail(
  toolName: string,
  input: Record<string, unknown>,
  state: BridgeState,
): string {
  if (toolName === "bash" && typeof input.command === "string") {
    return `Command:\n${truncate(input.command)}`;
  }

  if (toolName === "vscode_execute_code_action" && typeof input.actionId === "string") {
    const cached = state.codeActions.get(input.actionId);
    if (cached) return `Code action: ${cached.action.title}\nFile: ${cached.filePath}`;
  }

  return `Arguments:\n${truncate(stringifyInput(input))}`;
}

function stringifyInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "[Unable to serialize tool arguments]";
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_DETAIL_LENGTH) return value;
  return `${value.slice(0, MAX_DETAIL_LENGTH)}\n\n… ${value.length - MAX_DETAIL_LENGTH} characters omitted`;
}
