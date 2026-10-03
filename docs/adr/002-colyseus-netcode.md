# ADR-002: Colyseus 0.18 netcode with a shared step function

**Status:** Accepted · 3 Oct 2026

**Context.** Movement must feel instant on mobile networks while the server stays authoritative. Colyseus 0.18 added fixed-timestep rooms (`setFixedTimestep`, `defineInput`) and client prediction with rollback (`Predict`), driven by a step function the app supplies.

**Decision.** `packages/core` provides `PlaceWorld.stepAvatar`, used by the server room for every input and by the client reconciler for prediction and replay. Inputs are quantised to int8 so both sides read identical values. Only your own avatar is predicted; others are interpolated.

**Consequences.** No custom netcode to maintain. The step must stay deterministic for the same inputs (covered by a replay test). The prediction library caps catch-up at 5 steps per frame, so clients below about 6 fps move slower than real time; the quality-tier governor keeps real devices far above that.
