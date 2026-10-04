# ADR-011: The creator studio builds drafts as spaces

**Status:** Accepted · 4 Oct 2026 · amended by ADR-013 (no server-side agent; drafts are sketched and rebuilt by players' own agents; the MCP door is on by default)

**Context.** M2.10 asks for a draft corridor, background generation, steering by talking, and keep, save or submit, done when "an idea becomes a kept draft in a private space". Spaces (ADR-006, M2.5) and the building agent (ADR-007) already give live drafts, undo, saving and an AI that edits through the SDK.

**Decision.**

- **Drafts are spaces** with `stage = "draft"` (plus `idea`, `batchId`, `buildState`, `buildNote`). Rooms, knocking, live editing, the agent and saving work on them unchanged. They don't count towards the space limit and expire after a day.
- **One idea, three takes** (cosy, grand, playful), built one after another in the background after `POST /api/studio/drafts` returns, so the owner can walk into draft A while B and C are still being built. Each take is a request to the building agent with the variant's direction; without the agent (or when it fails or the quota runs out) a keyword-themed **sketch** lays the idea out through the same SDK tools and budgets, and the draft says it was sketched.
- **The corridor** is a bar inside a draft: previous and next draft, a box to steer this draft by talking (the agent's per-space conversation), and Keep. A new idea replaces the old batch.
- **Keep** saves any steering edits, turns the draft into an ordinary private space (the space limit applies here), and deletes the other drafts. **Save** is the build panel's. **Submit** puts a kept space in the public gallery (`submitted_at`, visibility public), listed in the Spaces panel.

**Consequences.** Drafts cost agent quota (three requests per idea) and database rows; both are bounded by one batch per player. There is no moderation queue for the gallery yet: submissions are visible at once and rely on reports, which needs revisiting before a wider launch.
