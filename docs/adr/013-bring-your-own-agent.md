# ADR-013: No AI of our own: players bring their own agents

**Status:** Accepted · 4 Oct 2026 · supersedes ADR-007

**Context.** ADR-007 put a Claude tool-use loop on the game server, paid for with our API key. The owner decided the server should call no language model: the owner builds with their own agent (Claude), and other players use theirs.

**Decision.**

- **The servers call no language model** and hold no model keys. The building agent, its in-game panel, the `agent` room messages and the Anthropic SDK dependency are removed.
- **The MCP door is how AI builds** (ADR-012), and it's on by default (`MCP_ENABLED=0` turns it off). Its building guidance, which used to be the agent's system prompt, is now sent as MCP server instructions.
- **The build panel's "🤖 Your AI" tab** shows the MCP URL and how to connect (for example `claude mcp add --transport http superworld <server>/mcp`). Players approve each app in the game.
- **The creator studio sketches drafts itself** (keyword themes through the SDK tools). Agents start it with `studio_make_drafts`, rebuild the drafts, and keep the player's choice with `studio_keep_draft`; drafts are listed by `spaces_list`.

**Consequences.** No model cost or quota for us; players' agents carry their own. Building with AI needs an MCP-capable app, so first-time players without one build by hand or from studio sketches. Gate 2 ("a new player builds a room without help") is measured on that basis. AI hosts in later phases follow the same rule unless a new record says otherwise.
