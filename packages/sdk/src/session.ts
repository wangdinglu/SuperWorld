import { Scene, type Template } from "@superworld/schema";
import { applyPatch, PatchError, type PatchOp } from "./patch.ts";
import { type Budgets, DEFAULT_BUDGETS, ToolError, TOOLS_BY_NAME } from "./tools.ts";

export type Actor = "player" | "agent" | "mcp" | "cli";

export interface EditStep {
  tool: string;
  actor: Actor;
  summary: string;
  patch: PatchOp[];
}

export type CallResult =
  | { ok: true; summary: string; output?: unknown; changed: boolean; patch: PatchOp[] }
  | { ok: false; error: string };

/** Checks a scene against the engine's rules. Returns problems (empty when fine). */
export function checkScene(
  scene: Scene,
  templates: ReadonlyMap<string, Template>,
  budgets: Budgets,
): string[] {
  const problems: string[] = [];
  const parsed = Scene.safeParse(scene);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  if (scene.instances.length > budgets.maxObjects) {
    problems.push(`Too many objects: ${scene.instances.length} (limit ${budgets.maxObjects})`);
  }
  if (scene.environment.ground.radius > budgets.maxGroundRadius) {
    problems.push(`Ground too large (limit ${budgets.maxGroundRadius} m)`);
  }
  let parts = 0;
  const ids = new Set<string>();
  for (const inst of scene.instances) {
    const template = templates.get(inst.template);
    if (!template) problems.push(`Unknown template "${inst.template}"`);
    parts += template?.parts.length ?? 0;
    if (ids.has(inst.id)) problems.push(`Duplicate object id "${inst.id}"`);
    ids.add(inst.id);
    if (Math.hypot(inst.at[0], inst.at[2]) > scene.environment.ground.radius - 0.5) {
      problems.push(`"${inst.id}" is off the ground (radius ${scene.environment.ground.radius} m)`);
    }
  }
  if (parts > budgets.maxParts)
    problems.push(`Too much detail: ${parts} parts (limit ${budgets.maxParts})`);
  const [sx, , sz] = scene.spawn[0]!.at;
  if (Math.hypot(sx, sz) > scene.environment.ground.radius - 1)
    problems.push("The arrival point is off the ground");
  return problems;
}

/**
 * A draft of one place being edited. Every tool call becomes a validated JSON Patch step that can
 * be undone; accepting saves the draft as a new revision.
 */
export class EditSession {
  private readonly steps: { scene: Scene; step: EditStep }[] = [];

  constructor(
    private readonly base: Scene,
    private readonly templates: ReadonlyMap<string, Template>,
    private readonly budgets: Budgets = DEFAULT_BUDGETS,
  ) {}

  get scene(): Scene {
    return this.steps.at(-1)?.scene ?? this.base;
  }

  get history(): readonly EditStep[] {
    return this.steps.map((s) => s.step);
  }

  get dirty(): boolean {
    return this.steps.length > 0;
  }

  /** All changes since the base, in order (stored with the revision). */
  get combinedPatch(): PatchOp[] {
    return this.steps.flatMap((s) => s.step.patch);
  }

  /** Runs one tool. Invalid input, tool errors and rule violations come back as `ok: false`. */
  call(name: string, input: unknown, actor: Actor): CallResult {
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) return { ok: false, error: `Unknown tool "${name}"` };
    const parsed = tool.input.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; "),
      };
    }
    try {
      const result = tool.run(
        { scene: this.scene, templates: this.templates, budgets: this.budgets },
        parsed.data,
      );
      if (!result.patch || result.patch.length === 0) {
        return {
          ok: true,
          summary: result.summary,
          output: result.output,
          changed: false,
          patch: [],
        };
      }
      const next = applyPatch(this.scene, result.patch);
      const problems = checkScene(next, this.templates, this.budgets);
      if (problems.length > 0) return { ok: false, error: problems.join("; ") };
      this.steps.push({
        scene: next,
        step: { tool: name, actor, summary: result.summary, patch: result.patch },
      });
      return {
        ok: true,
        summary: result.summary,
        output: result.output,
        changed: true,
        patch: result.patch,
      };
    } catch (err) {
      if (err instanceof ToolError || err instanceof PatchError)
        return { ok: false, error: err.message };
      throw err;
    }
  }

  /** Reverts the last step. Returns it, or undefined when there is nothing to undo. */
  undo(): EditStep | undefined {
    return this.steps.pop()?.step;
  }

  /** Discards every step. */
  reset(): void {
    this.steps.length = 0;
  }
}
