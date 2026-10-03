# ADR-005: Free-tier hosting

**Status:** Accepted · 3 Oct 2026

**Context.** Phase 1 needs a public link for playtests at no cost. The game server holds WebSocket connections, so serverless platforms (Vercel functions) don't fit. Fly.io and Railway no longer have free plans; Colyseus Cloud starts at $15/month.

**Decision.** Run the game server on Render's free web service; it also serves the built client, so one service is enough. Optionally host the client on Cloudflare Pages (free) and point it at Render with `VITE_SERVER_URL`. Move to a paid always-on plan (about $7–15/month) when the server must not sleep.

**Consequences.** The free server sleeps after 15 minutes idle; the client retries for up to a minute and tells the player it is waking up. Nothing in the code is tied to Render: the server is a plain Node process listening on `PORT`.
