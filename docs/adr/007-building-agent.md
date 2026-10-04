# ADR-007: The building agent

**Status:** Superseded by ADR-013 · 4 Oct 2026

**Context.** Gate 2 asks that a new player can build a room without help. The Creator SDK (ADR-003, M2.4) already validates every edit, so an agent can be given the same tools the build panel uses.

**Decision.**

- **A server-side tool-use loop** (`apps/server/src/agent.ts`) over the SDK registry, using the Claude Messages API through the Anthropic TypeScript SDK. The agent edits the space's shared draft as the owner (actor `agent`), so each step appears live in the room and can be undone; nothing is kept until the owner saves.
- **Model and key from the environment** (`AGENT_MODEL`, `ANTHROPIC_API_KEY`). Without them the agent is off and the client says so.
- **Request shape:** a stable system prompt and the sorted tool list (from `toolDefinitions()`) with automatic prompt caching; effort `medium`; tool choice left automatic (forced tool choice isn't supported on current models); the server-side refusal fallback (`fallbacks: "default"`). The current space is summarised in the user turn, after the cached prefix.
- **Errors go back to the model** as `is_error` tool results so it can correct itself (off the ground, unknown template, over budget).
- **History** is kept per space, append-only, and reset after 30 idle minutes or 60 messages. A refused turn is dropped.
- **Limits:** one request at a time per space; 16 tool rounds per request; daily quotas per player (guests 10, members 40 by default); `agent-usage` log lines (input, output and cache-read tokens) feed the cost ledger.

**Consequences.** Tests use a scripted model, so CI needs no key and costs nothing. Real quality and cost per session still need measuring with an eval set of typical requests before quotas are final (tracked in M2.6). A cheaper model for small edits can be tried later, but only after that eval shows Opus at low effort isn't better value.
