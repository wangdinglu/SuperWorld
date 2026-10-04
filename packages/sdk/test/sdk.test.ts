import { describe, expect, it } from "vitest";
import { Scene, TemplateLibrary } from "@superworld/schema";
import templatesJson from "../../../content/world/templates.json" with { type: "json" };
import {
  applyPatch,
  DEFAULT_BUDGETS,
  EditSession,
  PatchError,
  toolDefinitions,
  TOOLS,
} from "../src/index.ts";

const templates = new Map(TemplateLibrary.parse(templatesJson).templates.map((t) => [t.id, t]));
const empty = (): Scene =>
  Scene.parse({
    schema: "superworld.scene/1",
    place: "space-test",
    revision: 0,
    environment: { sky: "gradient", ground: { shape: "disc", radius: 20 } },
    spawn: [{ at: [0, 0, 5], radius: 2 }],
    instances: [],
    access: { visibility: "private" },
  });

describe("applyPatch", () => {
  it("adds, replaces, removes and tests without touching the input", () => {
    const doc = { a: [1, 2], b: { c: 1 } };
    const out = applyPatch(doc, [
      { op: "add", path: "/a/-", value: 3 },
      { op: "replace", path: "/b/c", value: 2 },
      { op: "remove", path: "/a/0" },
      { op: "test", path: "/a", value: [2, 3] },
    ]);
    expect(out).toEqual({ a: [2, 3], b: { c: 2 } });
    expect(doc).toEqual({ a: [1, 2], b: { c: 1 } });
  });

  it("rejects bad paths and failed tests", () => {
    expect(() => applyPatch({ a: 1 }, [{ op: "replace", path: "/missing", value: 1 }])).toThrow(
      PatchError,
    );
    expect(() => applyPatch({ a: 1 }, [{ op: "test", path: "/a", value: 2 }])).toThrow(PatchError);
  });
});

describe("EditSession", () => {
  it("places, moves and removes objects as validated steps", () => {
    const s = new EditSession(empty(), templates);
    const placed = s.call(
      "scene_place_object",
      { template: "prim/bench", x: 3, z: -2, yawDegrees: 90 },
      "player",
    );
    expect(placed).toMatchObject({ ok: true, changed: true, output: { id: "bench-1" } });
    expect(s.call("scene_move_object", { id: "bench-1", x: 4 }, "agent").ok).toBe(true);
    expect(s.scene.instances[0]).toMatchObject({ id: "bench-1", at: [4, 0, -2] });
    expect(s.scene.instances[0]!.yaw).toBeCloseTo(Math.PI / 2);
    expect(s.call("scene_remove_object", { id: "bench-1" }, "agent").ok).toBe(true);
    expect(s.scene.instances).toHaveLength(0);
    expect(s.history.map((h) => h.tool)).toEqual([
      "scene_place_object",
      "scene_move_object",
      "scene_remove_object",
    ]);
  });

  it("undo restores the exact previous scene", () => {
    const s = new EditSession(empty(), templates);
    s.call("scene_place_object", { template: "prim/tree", x: 1, z: 1 }, "player");
    const before = JSON.stringify(s.scene);
    s.call("style_set", { light: "neon", form: "voxel" }, "agent");
    expect(s.scene.style).toEqual({ light: "neon", form: "voxel" });
    s.undo();
    expect(JSON.stringify(s.scene)).toBe(before);
    s.undo();
    expect(s.dirty).toBe(false);
    expect(s.undo()).toBeUndefined();
  });

  it("refuses edits that break the rules, and explains why", () => {
    const s = new EditSession(empty(), templates);
    expect(
      s.call("scene_place_object", { template: "prim/bench", x: 30, z: 0 }, "agent"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("off the ground") });
    expect(
      s.call("scene_place_object", { template: "prim/dragon", x: 0, z: 0 }, "agent"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Unknown template") });
    expect(
      s.call("scene_place_object", { template: "prim/bench", x: "near", z: 0 }, "agent").ok,
    ).toBe(false);
    expect(s.call("scene_remove_object", { id: "ghost" }, "agent")).toMatchObject({
      ok: false,
      error: expect.stringContaining("ghost"),
    });
    expect(s.call("not_a_tool", {}, "agent").ok).toBe(false);
    expect(s.dirty).toBe(false);
  });

  it("enforces the object budget", () => {
    const s = new EditSession(empty(), templates, { ...DEFAULT_BUDGETS, maxObjects: 2 });
    s.call("scene_place_object", { template: "prim/lamp", x: 0, z: 0 }, "agent");
    s.call("scene_place_object", { template: "prim/lamp", x: 1, z: 0 }, "agent");
    expect(
      s.call("scene_place_object", { template: "prim/lamp", x: 2, z: 0 }, "agent"),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Too many objects") });
  });

  it("read-only tools return data and change nothing", () => {
    const s = new EditSession(empty(), templates);
    const listed = s.call("library_list_templates", {}, "agent");
    expect(
      listed.ok && (listed.output as { id: string }[]).some((t) => t.id === "prim/fountain"),
    ).toBe(true);
    expect(s.dirty).toBe(false);
  });

  it("sets text only on objects players can read, and says what objects do", () => {
    const s = new EditSession(empty(), templates);
    s.call("scene_place_object", { template: "prim/notice-board", x: 0, z: 0 }, "agent");
    s.call("scene_place_object", { template: "prim/bench", x: 4, z: 0 }, "agent");
    expect(
      s.call("scene_set_text", { id: "notice-board-1", text: "Party at eight" }, "agent").ok,
    ).toBe(true);
    expect(s.scene.instances[0]!.text).toBe("Party at eight");
    expect(s.call("scene_set_text", { id: "bench-1", text: "x" }, "agent")).toMatchObject({
      ok: false,
      error: expect.stringContaining("nothing to read"),
    });
    const listed = s.call("library_list_templates", {}, "agent");
    const byId = new Map(
      (listed.ok ? (listed.output as { id: string; players?: string }[]) : []).map((t) => [
        t.id,
        t.players,
      ]),
    );
    expect(byId.get("prim/bench")).toBe("sit (2 seats)");
    expect(byId.get("prim/ball-basket")).toBe("take a item/ball");
    expect(byId.get("prim/tree")).toBeUndefined();
  });

  it("sets screen effects as a list, without repeats", () => {
    const s = new EditSession(empty(), templates);
    expect(
      s.call("style_set", { surface: "ink", postEffects: ["grain", "bloom", "grain"] }, "agent").ok,
    ).toBe(true);
    expect(s.scene.style).toEqual({ surface: "ink", postEffects: ["grain", "bloom"] });
    expect(s.call("style_set", { postEffects: ["sparkles"] }, "agent").ok).toBe(false);
    s.call("style_set", { postEffects: [] }, "agent");
    expect(s.scene.style.postEffects).toEqual([]);
  });

  it("records the combined patch, which replays to the same scene", () => {
    const s = new EditSession(empty(), templates);
    s.call("scene_place_object", { template: "prim/fountain", x: 0, z: 0 }, "agent");
    s.call("space_set_spawn", { x: 0, z: 10 }, "agent");
    s.call("space_set_ground", { radius: 30, colour: "stone" }, "agent");
    expect(applyPatch(empty(), s.combinedPatch)).toEqual(s.scene);
  });
});

describe("tool definitions", () => {
  it("exports every tool with a strict JSON schema, sorted by name", () => {
    const defs = toolDefinitions();
    expect(defs).toHaveLength(TOOLS.length);
    expect(defs.map((d) => d.name)).toEqual([...defs.map((d) => d.name)].sort());
    for (const d of defs) {
      expect(d.name).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(d.input_schema.type).toBe("object");
      expect(d.input_schema.additionalProperties).toBe(false);
    }
    expect(JSON.stringify(toolDefinitions())).toBe(JSON.stringify(defs));
  });
});
