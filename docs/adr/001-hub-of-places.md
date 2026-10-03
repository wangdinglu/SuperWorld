# ADR-001: A hub of separate places, not one seamless map

**Status:** Accepted · 3 Oct 2026

**Context.** The plan wants one shared world on phones, with districts, private spaces and a studio. A seamless open world needs streaming terrain, server-side zone handover and far more bandwidth than a phone browser can afford.

**Decision.** The world is a plaza hub with separate places. Each place has its own scene file and its own server rooms. Travel is a room switch hidden by the camera zoom (walk → overview → atlas).

**Consequences.** Rooms stay small (about 50 players) and cheap. Each place can have its own style and rules. We need a travel flow that hides loading (map tiles, seat reservations) — built in Phase 3.
