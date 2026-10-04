import { type Db, getPublishedScene, saveRevision } from "@superworld/db";
import type { Scene, Template } from "@superworld/schema";
import { type Actor, type CallResult, EditSession, type PatchOp } from "@superworld/sdk";

export type EditorEvent =
  | { type: "patch"; patch: PatchOp[]; draftSteps: string[] }
  | { type: "scene"; scene: Scene; draftSteps: string[] }
  | { type: "saved"; scene: Scene; draftSteps: string[] };

/**
 * The live draft of one space. Shared by the space's room, the HTTP API door and the agent,
 * so every door edits the same draft and everyone in the room sees each step.
 */
export class SpaceEditor {
  private session: EditSession;
  private readonly listeners = new Set<(event: EditorEvent) => void>();
  lastUsed = Date.now();

  constructor(
    readonly placeId: string,
    base: Scene,
    private readonly templates: ReadonlyMap<string, Template>,
    private readonly db: Db,
  ) {
    this.session = new EditSession(base, templates);
  }

  get scene(): Scene {
    return this.session.scene;
  }

  get draftSteps(): string[] {
    return this.session.history.map((h) => h.summary);
  }

  subscribe(listener: (event: EditorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EditorEvent): void {
    this.lastUsed = Date.now();
    for (const l of this.listeners) l(event);
  }

  call(tool: string, input: unknown, actor: Actor): CallResult {
    const result = this.session.call(tool, input, actor);
    if (result.ok && result.changed)
      this.emit({ type: "patch", patch: result.patch, draftSteps: this.draftSteps });
    this.lastUsed = Date.now();
    return result;
  }

  undo(): boolean {
    const step = this.session.undo();
    if (step) this.emit({ type: "scene", scene: this.scene, draftSteps: this.draftSteps });
    return Boolean(step);
  }

  discard(): void {
    this.session.reset();
    this.emit({ type: "scene", scene: this.scene, draftSteps: this.draftSteps });
  }

  /** Saves the draft as a new published revision. */
  async save(authorId: string): Promise<Scene> {
    const actors = new Set(this.session.history.map((h) => h.actor));
    const actor = actors.size === 1 && actors.has("agent") ? "agent" : "player";
    const saved = await saveRevision(this.db, {
      placeId: this.placeId,
      scene: this.session.scene,
      patch: this.session.combinedPatch,
      authorId,
      actor,
      publish: true,
    });
    this.session = new EditSession(saved, this.templates);
    this.emit({ type: "saved", scene: saved, draftSteps: [] });
    return saved;
  }
}

/** One editor per space, created on first use and dropped after an hour without activity. */
export class SpaceEditors {
  private readonly editors = new Map<string, SpaceEditor>();

  constructor(
    private readonly db: Db,
    private readonly templates: ReadonlyMap<string, Template>,
  ) {}

  async get(placeId: string): Promise<SpaceEditor | undefined> {
    this.evictIdle();
    const existing = this.editors.get(placeId);
    if (existing) return existing;
    const scene = await getPublishedScene(this.db, placeId);
    if (!scene) return undefined;
    const editor = new SpaceEditor(placeId, scene, this.templates, this.db);
    this.editors.set(placeId, editor);
    return editor;
  }

  private evictIdle(now = Date.now()): void {
    for (const [id, editor] of this.editors) {
      if (now - editor.lastUsed > 60 * 60_000) this.editors.delete(id);
    }
  }
}
