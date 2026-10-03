# ADR-003: Content as data, validated by Zod

**Status:** Accepted · 3 Oct 2026

**Context.** Players and AI agents will create places and items. The engine must stay in control of how the world runs, and the same content must render in 3D, 2D and later native clients.

**Decision.** Worlds, scenes, templates and styles are JSON documents defined once in `packages/schema` with Zod (types, runtime validation, JSON Schema for tools). Phase 1 templates are built from primitive shapes. From Phase 2, every edit is a JSON Patch against a versioned scene.

**Consequences.** The plaza is edited by changing `content/world/plaza.scene.json`; CI validates it. The server builds colliders and the client builds visuals from the same file. New content never needs an engine release.
