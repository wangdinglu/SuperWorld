# Architecture decision records

One page per decision: context, decision, consequences. Add a new file rather than editing an accepted one; mark replaced records "Superseded by ADR-NNN".

| ADR                                       | Decision                                                                                   | Status                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [001](001-hub-of-places.md)               | A hub of separate places, not one seamless map                                             | Accepted                                 |
| [002](002-colyseus-netcode.md)            | Colyseus 0.18 netcode with a step function shared by server and client                     | Accepted                                 |
| [003](003-content-as-data.md)             | Content as Zod-validated data; edits as JSON Patch                                         | Accepted                                 |
| [004](004-phase-1-scope.md)               | Phase 1: no database, procedural avatars, TypeScript 6                                     | Accepted (avatars superseded by ADR-008) |
| [005](005-hosting.md)                     | Free-tier hosting: Render for the server, optional Cloudflare Pages for the client         | Accepted                                 |
| [006](006-accounts-and-database.md)       | Postgres via Drizzle, embedded PGlite fallback, email-link accounts                        | Accepted                                 |
| [007](007-building-agent.md)              | The building agent: a Claude tool-use loop over the Creator SDK                            | Accepted                                 |
| [008](008-vrm-avatars.md)                 | VRM avatars, one per style, made in code                                                   | Accepted                                 |
| [009](009-items-and-behaviours.md)        | Items and behaviours as template data, one shared implementation per kind                  | Accepted                                 |
| [010](010-materials-and-style-effects.md) | Finishes as TSL materials, outlines as geometry, screen effects per tier                   | Accepted                                 |
| [011](011-creator-studio.md)              | Creator studio drafts are spaces, built in the background; keep one, submit to the gallery | Accepted                                 |
