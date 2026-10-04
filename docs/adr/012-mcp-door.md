# ADR-012: The MCP door

**Status:** Accepted · 4 Oct 2026 · amended by ADR-013 (no server-side agent; drafts are sketched and rebuilt by players' own agents; the MCP door is on by default)

**Context.** M2.11 asks for an MCP server generated from the SDK registry, with OAuth, internal only. Done when an outside agent builds a room using only the MCP server. The SDK (ADR-003, M2.4) already has a door-independent tool registry with budgets, and an `mcp` actor in the revision log.

**Decision.**

- **Generated from the registry** (`apps/server/src/mcp.ts`): every SDK tool becomes an MCP tool with the same name and description, its input schema extended with `space`, and read-only hints from the registry. Four door tools sit beside them: `spaces_list`, `space_create`, `space_save`, `space_undo`. Calls run on the space's shared live draft as actor `mcp`, so anyone inside watches the edits, and nothing is published until `space_save`.
- **Transport:** the official TypeScript SDK (1.32), Streamable HTTP in stateless mode at `POST /mcp` (a fresh server per request; no sessions to keep on a free-tier host).
- **OAuth 2.1 with the SDK's router:** dynamic client registration, PKCE, refresh tokens and revocation. The authorization step redirects to the web client (`?mcp=<request>`), where the signed-in player sees the app's name and allows or denies it. Tokens map to that player and reach only their spaces. Grants are kept in memory.
- **Internal:** off unless `MCP_ENABLED=1`. Opening it publicly waits on per-client quotas, persisted grants and a list of connected apps the player can revoke.

**Consequences.** Outside agents get exactly the abilities, limits and undo the build panel and our own agent have, from one registry. A restart signs MCP clients out (they re-authorise).
