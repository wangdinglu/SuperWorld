# ADR-008: VRM avatars, one per style, made in code

**Status:** Accepted · 4 Oct 2026 · replaces the avatar part of [ADR-004](004-phase-1-scope.md)

**Context.** Phase 1 shipped a procedural mannequin so there were no outside assets and no licence questions. Players wanted a real character, and VRM 1.0 (planned for M2.3) gives us a humanoid skeleton, expressions, look-at and spring bones in one open format.

**Decision.**

- **The mannequin is replaced by VRM 1.0 avatars** loaded with `@pixiv/three-vrm`. MToon materials load as `MToonNodeMaterial`, so toon shading and outlines work on both WebGPU and the WebGL2 fallback.
- **A default set with one avatar per style.** Each avatar is drawn in a single style and its library entry names it: Sprout (smooth / soft / meadow, the plaza's own style and the default), Pip (low-poly / toon / candy), Inky (smooth / ink / mono, hand-written paper, hatching and brush outlines) and Bolt (voxel / PBR / dusk). Colours come from the style palettes, and each file records its style, which `pnpm validate:content` checks against `content/avatars/avatars.json`.
- **The avatars are made in code** (`tools/avatars`, `pnpm avatars`): still no outside assets, rebuilds are byte-identical, and the VRM licence metadata lets anyone use, change and redistribute them.
- **Animation stays procedural**, driven through three-vrm's normalized humanoid bones, so any VRM 1.0 avatar animates without per-model clips. VRM animation files (`.vrma`) can replace it later.
- **The player's avatar is part of the synced state** (`Player.avatar`, protocol v2). The server only accepts ids from the library, and players can switch at any time.
- Each avatar has an **"Accent" material** (a scarf, a chest panel) tinted in the player's colour, so the colour picked at sign-in still shows.

- **Downloaded avatars are allowed when openly licensed** (CC0 or CC-BY). Their library entry records the author, licence, original URL and SHA-256, and the repairs `pnpm avatars:import` applies to meet the VRM spec. The first is Polybot (CC0, Polygonal Mind's 100Avatars), a VRM 0.x model: the game turns 0.x models to face +Z and negates x/z bone rotations in the 0.x normalized frame.

**Consequences.** M2.3 is partly done early: three-vrm, a default set and the picker. Still to do: `.vrma` emotes, 2D sprites, and capping spring bones in crowds. Each avatar costs one download per file and its own parse per player (own materials and pose); the four files are 0.2–0.6 MB and 0.7k–7.6k triangles.
