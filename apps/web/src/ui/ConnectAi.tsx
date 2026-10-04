import { place } from "../store.ts";

/**
 * How to build with your own AI: SuperWorld has no AI of its own. Any agent that speaks MCP
 * (Claude Code, Claude Desktop and others) connects to the server's MCP door and builds as you,
 * after you approve it here in the game.
 */
export function ConnectAi(props: { compact?: boolean }) {
  const url = place.value?.mcpUrl;
  if (!url)
    return (
      <p class="muted-text small">
        Building with your own AI needs the game server's MCP door, which is off on this server.
      </p>
    );
  const command = `claude mcp add --transport http superworld ${url}`;
  return (
    <div class="stack connect-ai">
      <p class="small">
        Build with your own AI. Connect any MCP app (Claude Code, Claude Desktop…) to this server,
        approve it when the game asks, then ask it for anything:{" "}
        <i>“make my space a cosy reading garden”</i>. You watch every step happen here, and can undo
        it.
      </p>
      {!props.compact && (
        <>
          <span class="label">MCP server URL</span>
          <div class="row">
            <code class="grow">{url}</code>
            <button class="link" onClick={() => void navigator.clipboard?.writeText(url)}>
              Copy
            </button>
          </div>
          <span class="label">Claude Code</span>
          <div class="row">
            <code class="grow">{command}</code>
            <button class="link" onClick={() => void navigator.clipboard?.writeText(command)}>
              Copy
            </button>
          </div>
        </>
      )}
    </div>
  );
}
