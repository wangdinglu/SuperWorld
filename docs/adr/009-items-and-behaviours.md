# ADR-009: Items and behaviours as data

**Status:** Accepted · 4 Oct 2026

**Context.** M2.8 asks for objects players can sit on, hold, throw, wear, play and read, working in the plaza and in every space "without new code per item". Spaces are built by players and the agent, so a new object can't need engine changes.

**Decision.**

- **Behaviours live on templates** (`packages/schema` `Template.behaviours`): `sit` (seats with feet position and facing), `give` (hands out an item), `play` (a sound and a note sequence) and `screen` (title and text; an instance can override the text with `Instance.text`). A template with `item: { use: hold | throw | wear }` is an item; placing it in a scene makes a stand that hands it out. Driving waits for races (M3.2).
- **One implementation per kind, shared** (`packages/core/src/items.ts`): which interactions an object offers, reach, seats, standing up, throwing and a cheap ballistic step for loose items. The server room and solo practice both run it.
- **The server decides**: the client sends `interact` with an instance or prop id; the room re-checks reach (plus a metre of slack for latency) and free seats. Seats, held and worn items are fields on `Player`; loose items are a `props` map in the room state, at most 24, removed after 60 s. Reading a screen needs no server.
- **Seated avatars don't step**: the room skips movement until an input moves or jumps, then stands the avatar up. The client's prediction does the same, standing up once ahead of the server.
- **Inventory** is a `jsonb` list on `users` (at most 12, newest last), so items follow a player between places; you can only equip what you have. Solo practice keeps it in local storage.
- **Sounds are synthesised** with Web Audio, so there are no audio assets to host or license.

**Consequences.** Templates, the SDK and the agent get behaviours for free (`library_list_templates` says what each object does; `scene_set_text` writes notices). Loose items don't collide with objects, only the ground, which is fine for balls but not for physics toys; real physics props can come with the arena. The protocol version went up (to 3, together with the avatar field).
