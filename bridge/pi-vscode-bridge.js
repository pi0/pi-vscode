import path from "node:path";

export default function (pi) {
  const bridgeUrl = process.env.PI_VSCODE_BRIDGE_URL;
  const bridgeToken = process.env.PI_VSCODE_BRIDGE_TOKEN;

  if (!bridgeUrl || !bridgeToken) return;

  const MAX_RESULT_BYTES = 50 * 1024;
  const MAX_RESULT_LINES = 2000;
  const STATUS_ID = "pi-vscode";
  const STATUS_REFRESH_MS = 1500;
  const MAX_STATUS_PATH_LENGTH = 48;
  let statusTimer;
  let statusRefreshInFlight = false;
  let statusGeneration = 0;
  let lastStatusKey;

  const callBridge = async (method, params = {}) => {
    const response = await fetch(`${bridgeUrl}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-vscode-authorization": bridgeToken,
      },
      body: JSON.stringify({ method, params }),
    });

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload?.error || `Bridge request failed with status ${response.status}`;
      throw new Error(message);
    }
    return payload?.result;
  };

  const truncateText = (text) => {
    const lines = text.split("\n");
    let output =
      lines.length > MAX_RESULT_LINES ? lines.slice(0, MAX_RESULT_LINES).join("\n") : text;
    if (Buffer.byteLength(output, "utf8") > MAX_RESULT_BYTES) {
      const buffer = Buffer.from(output, "utf8");
      output = buffer.subarray(0, MAX_RESULT_BYTES).toString("utf8");
    }
    return output;
  };

  const boundedJson = (value) => {
    const text = JSON.stringify(value) ?? "null";
    const lineCount = text.split("\n").length;
    const byteCount = Buffer.byteLength(text, "utf8");
    if (lineCount <= MAX_RESULT_LINES && byteCount <= MAX_RESULT_BYTES) return text;
    return JSON.stringify({
      truncated: true,
      message:
        "VS Code bridge result exceeded output limits. Re-run the tool with a narrower file/range/query if you need complete structured data.",
      originalBytes: byteCount,
      originalLines: lineCount,
      resultJsonPrefix: truncateText(text),
    });
  };

  const jsonResult = async (method, params) => ({
    content: [{ type: "text", text: boundedJson(await callBridge(method, params)) }],
    details: {},
  });

  const workspaceRelativePath = (filePath, workspaceFolders = []) => {
    if (!filePath) return "";
    const roots = [
      ...workspaceFolders.map((folder) => folder?.filePath).filter(Boolean),
      process.cwd(),
    ];

    let best = filePath;
    for (const root of roots) {
      const relative = path.relative(root, filePath);
      if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        if (!relative) return path.basename(filePath);
        if (relative.length < best.length) best = relative;
      }
    }
    return best;
  };

  const shortenPath = (filePath) => {
    if (filePath.length <= MAX_STATUS_PATH_LENGTH) return filePath;
    const parts = filePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return `…${filePath.slice(-(MAX_STATUS_PATH_LENGTH - 1))}`;
    const shortened = `…/${parts.slice(-2).join("/")}`;
    if (shortened.length <= MAX_STATUS_PATH_LENGTH) return shortened;
    return `…${shortened.slice(-(MAX_STATUS_PATH_LENGTH - 1))}`;
  };

  const formatSelectionStatus = (selection) => {
    if (!selection) return "no selection";
    const startLine = selection.start.line + 1;
    const startCharacter = selection.start.character + 1;
    const endLine = selection.end.line + 1;
    const endCharacter = selection.end.character + 1;
    if (selection.isEmpty) return `Ln ${startLine}, Col ${startCharacter}`;

    const selectedCharacters = selection.selectedCharacterCount ?? selection.text?.length;
    if (startLine === endLine) {
      const size = selectedCharacters === undefined ? "" : ` ${selectedCharacters} chars`;
      return `sel${size} @ ${startLine}:${startCharacter}-${endCharacter}`;
    }
    return `sel ${selection.selectedLineCount ?? endLine - startLine + 1} lines @ ${startLine}-${endLine}`;
  };

  const diagnosticsStatus = (counts) => {
    const parts = [];
    if (counts.errors) parts.push(`E${counts.errors}`);
    if (counts.warnings) parts.push(`W${counts.warnings}`);
    if (counts.infos) parts.push(`I${counts.infos}`);
    if (counts.hints) parts.push(`H${counts.hints}`);
    return parts.length > 0 ? parts.join(" ") : "✓";
  };

  const formatStatus = (status, ctx) => {
    const theme = ctx.ui.theme;
    const prefix = theme.fg("accent", "VS Code");
    const activeEditor = status?.activeEditor;
    if (!activeEditor?.filePath) return `${prefix}: ${theme.fg("dim", "no active editor")}`;

    const relativePath = shortenPath(
      workspaceRelativePath(activeEditor.filePath, status.workspaceFolders),
    );
    const dirty = activeEditor.isDirty ? theme.fg("warning", "● ") : "";
    const language = activeEditor.languageId ? ` • ${activeEditor.languageId}` : "";
    const selectionText = formatSelectionStatus(status.selection);
    const diagnosticCounts = status.diagnostics ?? { errors: 0, warnings: 0, infos: 0, hints: 0 };
    const issueText = diagnosticsStatus(diagnosticCounts);
    const coloredIssues =
      diagnosticCounts.errors > 0
        ? theme.fg("error", issueText)
        : diagnosticCounts.warnings > 0
          ? theme.fg("warning", issueText)
          : theme.fg("success", issueText);

    return `${prefix}: ${dirty}${relativePath} • ${selectionText}${language} • ${coloredIssues}`;
  };

  const setStatus = (ctx, statusKey, statusText) => {
    if (!ctx?.hasUI) return;
    if (statusKey === lastStatusKey) return;
    lastStatusKey = statusKey;
    ctx.ui.setStatus(STATUS_ID, statusText);
  };

  const refreshStatus = async (ctx, generation = statusGeneration) => {
    if (!ctx?.hasUI || generation !== statusGeneration || statusRefreshInFlight) return;
    statusRefreshInFlight = true;
    try {
      const status = await callBridge("getStatus");
      if (generation !== statusGeneration) return;
      const statusText = formatStatus(status, ctx);
      setStatus(ctx, statusText, statusText);
    } catch (error) {
      if (generation !== statusGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      const statusText = `${ctx.ui.theme.fg("accent", "VS Code")}: ${ctx.ui.theme.fg(
        "warning",
        `bridge unavailable (${message})`,
      )}`;
      setStatus(ctx, `error:${message}`, statusText);
    } finally {
      statusRefreshInFlight = false;
    }
  };

  const stopStatusUpdates = (ctx) => {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = undefined;
    }
    statusGeneration++;
    lastStatusKey = undefined;
    if (ctx?.hasUI) ctx.ui.setStatus(STATUS_ID, undefined);
  };

  const startStatusUpdates = (ctx) => {
    if (!ctx?.hasUI) return;
    stopStatusUpdates(ctx);
    const generation = statusGeneration;
    void refreshStatus(ctx, generation);
    statusTimer = setInterval(() => {
      void refreshStatus(ctx, generation);
    }, STATUS_REFRESH_MS);
  };

  pi.on("session_start", async (_event, ctx) => {
    startStatusUpdates(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    void refreshStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    void refreshStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopStatusUpdates(ctx);
  });

  const tool = ({ rpcMethod, parameters, ...definition }) => ({
    ...definition,
    parameters,
    execute: async (_toolCallId, params) => jsonResult(rpcMethod, params),
  });

  const noParamsTool = ({ rpcMethod, ...definition }) => ({
    ...definition,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => jsonResult(rpcMethod),
  });

  const tools = [
    noParamsTool({
      name: "vscode_get_editor_state",
      label: "VS Code Editor State",
      description:
        "Get the active editor, current selection, cached latest selection, workspace folders, and open editors from VS Code.",
      promptSnippet: "Read current VS Code editor state, selection, and open editors.",
      promptGuidelines: [
        "Use VS Code bridge tools when the user asks about their current editor state, selection, diagnostics, symbols, definitions, hovers, references, or editor actions.",
        "If vscode_get_code_actions returns an action id, use vscode_execute_code_action to apply that exact quick fix.",
        "Use vscode_apply_workspace_edit when you need VS Code to update open buffers with explicit range-based edits.",
        "Use vscode_format_document or vscode_format_range to apply formatter-generated edits through VS Code instead of shelling out to formatters for open or dirty files.",
      ],
      rpcMethod: "getEditorState",
    }),
    noParamsTool({
      name: "vscode_get_selection",
      label: "VS Code Current Selection",
      description:
        "Get the current VS Code editor selection, including text, file path, and coordinates. Falls back to the latest cached VS Code selection when focus is in the pi terminal.",
      promptSnippet: "Read the exact active or latest cached VS Code selection and selected text.",
      rpcMethod: "getCurrentSelection",
    }),
    noParamsTool({
      name: "vscode_get_latest_selection",
      label: "VS Code Latest Selection",
      description:
        "Get the latest cached selection observed by the VS Code extension, even if focus moved away.",
      rpcMethod: "getLatestSelection",
    }),
    tool({
      name: "vscode_get_diagnostics",
      label: "VS Code Diagnostics",
      description:
        "Get VS Code diagnostics (LSP, lint, or type errors) for a file or the full workspace.",
      promptSnippet: "Read current VS Code diagnostics for a file or the workspace.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Optional absolute or workspace-relative file path",
          },
        },
        additionalProperties: false,
      },
      rpcMethod: "getDiagnostics",
    }),
    noParamsTool({
      name: "vscode_get_open_editors",
      label: "VS Code Open Editors",
      description:
        "List open editors and tabs in VS Code, including which one is active and whether files are dirty.",
      rpcMethod: "getOpenEditors",
    }),
    noParamsTool({
      name: "vscode_get_workspace_folders",
      label: "VS Code Workspace Folders",
      description: "List VS Code workspace folders and metadata for the current window.",
      rpcMethod: "getWorkspaceFolders",
    }),
    tool({
      name: "vscode_open_file",
      label: "VS Code Open File",
      description: "Open a file in VS Code and optionally reveal a selection range.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          preview: { type: "boolean", description: "Open in preview mode" },
          preserveFocus: {
            type: "boolean",
            description: "Keep focus in the current editor if possible",
          },
          selection: {
            type: "object",
            properties: {
              start: {
                type: "object",
                properties: {
                  line: { type: "number", description: "Zero-based line number" },
                  character: { type: "number", description: "Zero-based character offset" },
                },
                required: ["line", "character"],
                additionalProperties: false,
              },
              end: {
                type: "object",
                properties: {
                  line: { type: "number", description: "Zero-based line number" },
                  character: { type: "number", description: "Zero-based character offset" },
                },
                required: ["line", "character"],
                additionalProperties: false,
              },
            },
            required: ["start", "end"],
            additionalProperties: false,
          },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "openFile",
    }),
    tool({
      name: "vscode_check_document_dirty",
      label: "VS Code Dirty State",
      description: "Check whether a file is open in VS Code and whether it has unsaved changes.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "checkDocumentDirty",
    }),
    tool({
      name: "vscode_save_document",
      label: "VS Code Save Document",
      executionMode: "sequential",
      description: "Save a document through VS Code so editor buffers and disk stay synchronized.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "saveDocument",
    }),
    tool({
      name: "vscode_get_document_symbols",
      label: "VS Code Document Symbols",
      description: "Get outline symbols for a file from the active language server.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "getDocumentSymbols",
    }),
    tool({
      name: "vscode_get_definitions",
      label: "VS Code Definitions",
      description: "Get symbol definitions from VS Code at a given file position.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          position: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath", "position"],
        additionalProperties: false,
      },
      rpcMethod: "getDefinitions",
    }),
    tool({
      name: "vscode_get_type_definitions",
      label: "VS Code Type Definitions",
      description: "Get symbol type definitions from VS Code at a given file position.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          position: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath", "position"],
        additionalProperties: false,
      },
      rpcMethod: "getTypeDefinitions",
    }),
    tool({
      name: "vscode_get_implementations",
      label: "VS Code Implementations",
      description: "Get concrete implementations from VS Code at a given file position.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          position: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath", "position"],
        additionalProperties: false,
      },
      rpcMethod: "getImplementations",
    }),
    tool({
      name: "vscode_get_declarations",
      label: "VS Code Declarations",
      description: "Get symbol declarations from VS Code at a given file position.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          position: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath", "position"],
        additionalProperties: false,
      },
      rpcMethod: "getDeclarations",
    }),
    tool({
      name: "vscode_get_hover",
      label: "VS Code Hover",
      description:
        "Get hover information like inferred types, signatures, and docs from VS Code at a given file position.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          position: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath", "position"],
        additionalProperties: false,
      },
      rpcMethod: "getHover",
    }),
    tool({
      name: "vscode_get_workspace_symbols",
      label: "VS Code Workspace Symbols",
      description: "Search workspace symbols globally through VS Code language providers.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Workspace symbol search query" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      rpcMethod: "getWorkspaceSymbols",
    }),
    tool({
      name: "vscode_get_references",
      label: "VS Code References",
      description: "Get symbol references from VS Code at a given file position.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          position: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath", "position"],
        additionalProperties: false,
      },
      rpcMethod: "getReferences",
    }),
    tool({
      name: "vscode_get_code_actions",
      label: "VS Code Code Actions",
      description:
        "Get code actions or quick fixes available for a file range or selection from VS Code providers.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          selection: {
            type: "object",
            properties: {
              start: {
                type: "object",
                properties: {
                  line: { type: "number", description: "Zero-based line number" },
                  character: { type: "number", description: "Zero-based character offset" },
                },
                required: ["line", "character"],
                additionalProperties: false,
              },
              end: {
                type: "object",
                properties: {
                  line: { type: "number", description: "Zero-based line number" },
                  character: { type: "number", description: "Zero-based character offset" },
                },
                required: ["line", "character"],
                additionalProperties: false,
              },
            },
            required: ["start", "end"],
            additionalProperties: false,
          },
          start: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
          end: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "getCodeActions",
    }),
    tool({
      name: "vscode_execute_code_action",
      label: "VS Code Execute Code Action",
      executionMode: "sequential",
      description: "Execute a previously listed code action by id.",
      parameters: {
        type: "object",
        properties: {
          actionId: {
            type: "string",
            description: "Action id returned by vscode_get_code_actions",
          },
        },
        required: ["actionId"],
        additionalProperties: false,
      },
      rpcMethod: "executeCodeAction",
    }),
    tool({
      name: "vscode_apply_workspace_edit",
      label: "VS Code Apply Workspace Edit",
      executionMode: "sequential",
      description:
        "Apply explicit range-based text replacements through VS Code so open editor buffers stay in sync.",
      parameters: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            description: "List of text replacements to apply through VS Code",
            items: {
              type: "object",
              properties: {
                filePath: {
                  type: "string",
                  description: "Absolute or workspace-relative file path",
                },
                range: {
                  type: "object",
                  properties: {
                    start: {
                      type: "object",
                      properties: {
                        line: { type: "number", description: "Zero-based line number" },
                        character: {
                          type: "number",
                          description: "Zero-based character offset",
                        },
                      },
                      required: ["line", "character"],
                      additionalProperties: false,
                    },
                    end: {
                      type: "object",
                      properties: {
                        line: { type: "number", description: "Zero-based line number" },
                        character: {
                          type: "number",
                          description: "Zero-based character offset",
                        },
                      },
                      required: ["line", "character"],
                      additionalProperties: false,
                    },
                  },
                  required: ["start", "end"],
                  additionalProperties: false,
                },
                newText: { type: "string", description: "Replacement text" },
              },
              required: ["filePath", "range", "newText"],
              additionalProperties: false,
            },
          },
        },
        required: ["edits"],
        additionalProperties: false,
      },
      rpcMethod: "applyWorkspaceEdit",
    }),
    tool({
      name: "vscode_format_document",
      label: "VS Code Format Document",
      executionMode: "sequential",
      description:
        "Run the active VS Code document formatter for a file and apply the resulting edits through VS Code.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "formatDocument",
    }),
    tool({
      name: "vscode_format_range",
      label: "VS Code Format Range",
      executionMode: "sequential",
      description:
        "Run the active VS Code range formatter for a selection or explicit range and apply the resulting edits through VS Code.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Absolute or workspace-relative file path" },
          selection: {
            type: "object",
            properties: {
              start: {
                type: "object",
                properties: {
                  line: { type: "number", description: "Zero-based line number" },
                  character: { type: "number", description: "Zero-based character offset" },
                },
                required: ["line", "character"],
                additionalProperties: false,
              },
              end: {
                type: "object",
                properties: {
                  line: { type: "number", description: "Zero-based line number" },
                  character: { type: "number", description: "Zero-based character offset" },
                },
                required: ["line", "character"],
                additionalProperties: false,
              },
            },
            required: ["start", "end"],
            additionalProperties: false,
          },
          start: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
          end: {
            type: "object",
            properties: {
              line: { type: "number", description: "Zero-based line number" },
              character: { type: "number", description: "Zero-based character offset" },
            },
            required: ["line", "character"],
            additionalProperties: false,
          },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
      rpcMethod: "formatRange",
    }),
    tool({
      name: "vscode_get_notifications",
      label: "VS Code Notifications",
      description:
        "Get recent bridge notifications like selection changes, diagnostics changes, active editor changes, and save/dirty events.",
      parameters: {
        type: "object",
        properties: {
          since: { type: "number", description: "Only return notifications after this timestamp" },
          limit: { type: "number", description: "Maximum number of notifications to return" },
        },
        additionalProperties: false,
      },
      rpcMethod: "getNotifications",
    }),
    noParamsTool({
      name: "vscode_clear_notifications",
      label: "VS Code Clear Notifications",
      description: "Clear the buffered VS Code bridge notification queue.",
      rpcMethod: "clearNotifications",
    }),
    tool({
      name: "vscode_show_notification",
      label: "VS Code Show Notification",
      description: "Show an info, warning, or error notification inside VS Code.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Notification message to show in VS Code" },
          type: {
            type: "string",
            description: "Notification severity: info, warning, or error",
            enum: ["info", "warning", "error"],
          },
          modal: { type: "boolean", description: "Whether to show the notification as modal" },
        },
        required: ["message"],
        additionalProperties: false,
      },
      rpcMethod: "showNotification",
    }),
  ];

  for (const toolDefinition of tools) pi.registerTool(toolDefinition);
}
