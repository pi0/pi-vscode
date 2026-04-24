import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import * as vscode from "vscode";
import { handleRpc } from "./handlers.ts";
import { captureSelection, getEditorInfo } from "./serialize.ts";
import { createBridgeState } from "./state.ts";
import type { BridgeContext, RpcRequest } from "./types.ts";
import { toErrorMessage } from "./utils.ts";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export async function createBridge(
  context: vscode.ExtensionContext,
  onTerminalSession?: (terminalId: string, sessionFile: string) => void,
): Promise<BridgeContext> {
  const state = createBridgeState(
    captureSelection(vscode.window.activeTextEditor),
    onTerminalSession,
  );
  const dirtyState = new Map<string, boolean>();
  const token = randomUUID();

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      state.latestSelection = captureSelection(event.textEditor);
      state.enqueue("selection_changed", state.latestSelection);
    }),
    vscode.languages.onDidChangeDiagnostics((event) => {
      state.enqueue("diagnostics_changed", {
        uris: event.uris.map((uri) => ({ filePath: uri.fsPath, fileUri: uri.toString() })),
      });
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const captured = captureSelection(editor);
      if (captured) state.latestSelection = captured;
      state.enqueue("active_editor_changed", editor ? getEditorInfo(editor) : undefined);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      state.enqueue("visible_editors_changed", editors.map(getEditorInfo));
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme !== "file") return;
      const key = event.document.uri.toString();
      const wasDirty = dirtyState.get(key) ?? false;
      const isDirty = event.document.isDirty;
      if (wasDirty === isDirty) return;
      dirtyState.set(key, isDirty);
      state.enqueue("document_dirty_changed", {
        filePath: event.document.uri.fsPath,
        fileUri: event.document.uri.toString(),
        isDirty,
        languageId: event.document.languageId,
      });
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme !== "file") return;
      const key = document.uri.toString();
      const wasDirty = dirtyState.get(key) ?? false;
      dirtyState.set(key, false);
      if (wasDirty) {
        state.enqueue("document_dirty_changed", {
          filePath: document.uri.fsPath,
          fileUri: document.uri.toString(),
          isDirty: false,
          languageId: document.languageId,
        });
      }
      state.enqueue("document_saved", {
        filePath: document.uri.fsPath,
        fileUri: document.uri.toString(),
        languageId: document.languageId,
      });
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme !== "file") return;
      dirtyState.delete(document.uri.toString());
    }),
  );

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/rpc") {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.headers["x-pi-vscode-authorization"] !== token) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      let body: unknown;
      try {
        body = await readJson(request);
      } catch (error) {
        const status = error instanceof PayloadTooLargeError ? 413 : 400;
        sendJson(response, status, { error: toErrorMessage(error) });
        return;
      }
      const rpc = isRpcRequest(body) ? body : undefined;
      if (!rpc?.method) {
        sendJson(response, 400, { error: "Invalid RPC request" });
        return;
      }

      const result = await handleRpc(rpc.method, rpc.params ?? {}, state);
      sendJson(response, 200, { result });
    } catch (error) {
      sendJson(response, 500, { error: toErrorMessage(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind pi-vscode bridge server");
  }

  return {
    server,
    token,
    url: `http://127.0.0.1:${address.port}`,
    dispose: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      request.destroy();
      throw new PayloadTooLargeError(MAX_REQUEST_BYTES);
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as unknown) : {};
}

function isRpcRequest(value: unknown): value is RpcRequest {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
