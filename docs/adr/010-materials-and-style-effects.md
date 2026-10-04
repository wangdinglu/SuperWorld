# ADR-010: The material library and style effects

**Status:** Accepted · 4 Oct 2026

**Context.** M2.9 asks for TSL materials (PBR, toon, glass, water, emissive, hologram) with fallbacks per tier, and every style topic working on real places. ADR-004 deferred outlines to this milestone. ARCHITECTURE.md §8 budgets screen effects per tier: none on low, outline and grain on medium, all on high.

**Decision.**

- **Finishes are part data**: a template part can have `finish: metal | glass | water | hologram` beside the style's surface topic (`packages/render/src/materials.ts`). Water ripples, glass fresnel and hologram scanlines are TSL node materials, so they run on WebGPU and the WebGL2 fallback alike. The low tier gets static stand-ins with the same colours (`TierSettings.materials = "lite"`). Materials are cached per colour, topic, finish, quality and environment.
- **Outlines are geometry, not a screen pass**: for the ink surface or the outline effect, each instanced part is drawn again inside out with a TSL vertex offset along the direction from the part's centre (no cracks at box corners). It shares the instance matrices, costs one extra draw per part type, and is off on the low tier.
- **Atmosphere**: mist thickens and pales the fog; stars are a fixed-seed point sky; petals are one instanced mesh wrapping around the camera. Particle counts scale per tier.
- **Screen effects** run through a three.js `RenderPipeline` only when the style asks for one the tier allows (`StylePipeline`): pixelate (sampling the scene pass at block centres, as three's pixelation pass rendered black on WebGL2), film grain, and bloom. Tiers: low pixelate only (it changes the look and costs almost nothing); medium adds grain; high adds bloom. With no effects the renderer draws straight to the canvas.
- **One mixer for everyone**: the build panel's style tab covers every topic and toggles effects; `style_set` takes `postEffects` as a full list, so the agent uses the same controls.

**Consequences.** A tier drop rebuilds the place with cheaper materials and effects. Styles stay data in the scene, so a space looks the same on every device apart from what its tier skips. Custom shaders (node graphs → TSL) remain Phase 3 (M3.5).
