import { requiresApproval } from "./pi-vscode-approval-policy.js";

export default function (pi) {
  const bridgeUrl = process.env.PI_VSCODE_BRIDGE_URL;
  const bridgeToken = process.env.PI_VSCODE_BRIDGE_TOKEN;

  if (!bridgeUrl || !bridgeToken) return;

  const requestApproval = async (toolName, input, signal) => {
    const response = await fetch(`${bridgeUrl}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-vscode-authorization": bridgeToken,
      },
      body: JSON.stringify({ method: "requestApproval", params: { toolName, input } }),
      signal,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload?.error || `Bridge request failed with status ${response.status}`;
      throw new Error(message);
    }
    return payload?.result;
  };

  pi.on("tool_call", async (event, ctx) => {
    if (!requiresApproval(event.toolName)) return;

    try {
      const result = await requestApproval(event.toolName, event.input, ctx.signal);
      if (result?.approved) return;
      return { block: true, reason: `User denied permission for ${event.toolName}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        block: true,
        reason: `Could not obtain VS Code approval for ${event.toolName}: ${message}`,
      };
    }
  });
}
