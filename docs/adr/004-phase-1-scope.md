# ADR-004: Phase 1 scope choices

**Status:** Accepted · 3 Oct 2026 · the avatar choice is superseded by [ADR-006](006-vrm-avatars.md)

**Decision.**

- **No database.** Guests get HMAC-signed tokens; the plaza ships in the repo; chat isn't stored. Persistence arrives with private spaces (M2.1).
- **Procedural mannequin avatars** built from primitives — no outside assets, no licence questions. VRM 1.0 arrives in M2.3.
- **TypeScript 6.0**, because typescript-eslint doesn't support TypeScript 7 yet.
- **Post-effects (outlines) deferred** to the material library milestone (M2.9); Phase 1 uses library materials and blob shadows on lower tiers.

**Consequences.** Phase 1 runs with zero infrastructure (`pnpm dev`) and deploys as one free service.
