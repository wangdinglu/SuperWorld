# Architecture decision records

One page per decision: context, decision, consequences. Add a new file rather than editing an accepted one; mark replaced records "Superseded by ADR-NNN".

| ADR                                 | Decision                                                                           | Status   |
| ----------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| [001](001-hub-of-places.md)         | A hub of separate places, not one seamless map                                     | Accepted |
| [002](002-colyseus-netcode.md)      | Colyseus 0.18 netcode with a step function shared by server and client             | Accepted |
| [003](003-content-as-data.md)       | Content as Zod-validated data; edits as JSON Patch                                 | Accepted |
| [004](004-phase-1-scope.md)         | Phase 1: no database, procedural avatars, TypeScript 6                             | Accepted |
| [005](005-hosting.md)               | Free-tier hosting: Render for the server, optional Cloudflare Pages for the client | Accepted |
| [006](006-accounts-and-database.md) | Postgres via Drizzle, embedded PGlite fallback, email-link accounts                | Accepted |
| [007](007-building-agent.md)        | The building agent: a Claude tool-use loop over the Creator SDK                    | Accepted |
