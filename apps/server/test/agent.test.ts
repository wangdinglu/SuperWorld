import { describe, expect, it } from "vitest";
import { openDatabase, createGuest, createSpace } from "@superworld/db";
import { BuildingAgent, type MessagesClient } from "../src/agent.ts";
import { SpaceEditors } from "../src/editors.ts";
import { loadContent } from "../src/content.ts";
import { starterScene } from "../src/spaces.ts";

const content = loadContent();
const templates = new Map(content.templates.templates.map((t) => [t.id, t]));
const config = { model: "test-model", maxRounds: 4, dailyLimit: { guest: 3, member: 10 } };

let n = 0;
const toolUse = (name: string, input: unknown) => ({
  type: "tool_use",
  id: `tu_${++n}`,
  name,
  input,
});
const reply = (content: unknown[], stop: string) =>
  ({
    id: `msg_${++n}`,
    type: "message",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: stop,
    usage: { input_tokens: 100, output_tokens: 20 },
  }) as never;

/** A fake Claude that replays scripted responses and records every request. */
function scripted(...responses: unknown[]) {
  const requests: any[] = [];
  const client: MessagesClient = {
    async create(params) {
      requests.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error("no more scripted responses");
      return next as never;
    },
  };
  return { client, requests };
}

async function setup() {
  const database = await openDatabase();
  const owner = await createGuest(database.db, { displayName: "Owner", colour: "#123456" });
  const id = "s-agenttest1";
  await createSpace(database.db, { id, ownerId: owner.id, name: "Test", scene: starterScene(id) });
  const editors = new SpaceEditors(database.db, templates);
  const editor = (await editors.get(id))!;
  return { database, owner, editor };
}

describe("BuildingAgent", () => {
  it("builds through the SDK tools and returns a short summary", async () => {
    const { owner, editor, database } = await setup();
    const fake = scripted(
      reply(
        [
          { type: "text", text: "Building it." },
          toolUse("scene_place_object", { template: "prim/fountain", x: 0, z: -6 }),
          toolUse("style_set", { light: "golden" }),
        ],
        "tool_use",
      ),
      reply(
        [{ type: "text", text: "I added a fountain and golden light. You can Undo or Save." }],
        "end_turn",
      ),
    );
    const progress: string[] = [];
    const agent = new BuildingAgent(fake.client, config);
    const result = await agent.run(
      editor,
      { id: owner.id, kind: "guest" },
      "a sunny fountain",
      (p) => progress.push(p.step ?? p.state),
    );

    expect(result.error).toBeUndefined();
    expect(result.text).toContain("fountain");
    expect(result.steps).toHaveLength(2);
    expect(editor.scene.instances.some((i) => i.template === "prim/fountain")).toBe(true);
    expect(editor.scene.style.light).toBe("golden");
    expect(progress).toEqual(["thinking", "scene_place_object", "style_set"]);

    // The request shape: cached prefix, sorted tools, refusal fallback, briefing in the user turn.
    const first = fake.requests[0];
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.fallbacks).toBe("default");
    expect(first.tools.map((t: any) => t.name)).toEqual(
      [...first.tools.map((t: any) => t.name)].sort(),
    );
    expect(first.messages[0].content).toContain("Owner's request: a sunny fountain");
    expect(first.tool_choice).toBeUndefined();
    // Both tool results go back together, in one user message.
    const second = fake.requests[1];
    const results = second.messages.at(-1).content;
    expect(results).toHaveLength(2);
    expect(results.every((r: any) => r.type === "tool_result")).toBe(true);
    await database.close();
  });

  it("sends tool errors back so the model can correct itself", async () => {
    const { owner, editor, database } = await setup();
    const fake = scripted(
      reply(
        [toolUse("scene_place_object", { template: "prim/fountain", x: 50, z: 0 })],
        "tool_use",
      ),
      reply([toolUse("scene_place_object", { template: "prim/fountain", x: 2, z: 0 })], "tool_use"),
      reply([{ type: "text", text: "Placed it nearer the middle." }], "end_turn"),
    );
    const result = await new BuildingAgent(fake.client, config).run(
      editor,
      { id: owner.id, kind: "guest" },
      "fountain",
      () => {},
    );
    const error = fake.requests[1].messages.at(-1).content[0];
    expect(error).toMatchObject({ is_error: true });
    expect(error.content).toContain("off the ground");
    expect(result.steps).toHaveLength(1);
    await database.close();
  });

  it("reports refusals without keeping the refused turn", async () => {
    const { owner, editor, database } = await setup();
    const fake = scripted(
      reply([], "refusal"),
      reply([{ type: "text", text: "Sure." }], "end_turn"),
    );
    const agent = new BuildingAgent(fake.client, config);
    const refused = await agent.run(
      editor,
      { id: owner.id, kind: "guest" },
      "something bad",
      () => {},
    );
    expect(refused.error).toContain("can't help");
    await agent.run(editor, { id: owner.id, kind: "guest" }, "a bench", () => {});
    // The second request starts clean: just its own user turn.
    expect(fake.requests[1].messages).toHaveLength(1);
    await database.close();
  });

  it("limits requests per player per day", async () => {
    const { owner, editor, database } = await setup();
    const fake = scripted(
      ...Array.from({ length: 5 }, () => reply([{ type: "text", text: "ok" }], "end_turn")),
    );
    const agent = new BuildingAgent(fake.client, config);
    for (let i = 0; i < 3; i++)
      expect(
        (await agent.run(editor, { id: owner.id, kind: "guest" }, "hi", () => {})).error,
      ).toBeUndefined();
    const blocked = await agent.run(editor, { id: owner.id, kind: "guest" }, "hi", () => {});
    expect(blocked.error).toContain("Keep your account");
    await database.close();
  });

  it("stops after the round limit and says so", async () => {
    const { owner, editor, database } = await setup();
    const fake = scripted(
      ...Array.from({ length: 4 }, (_, i) =>
        reply([toolUse("scene_place_object", { template: "prim/lamp", x: i, z: 2 })], "tool_use"),
      ),
    );
    const result = await new BuildingAgent(fake.client, config).run(
      editor,
      { id: owner.id, kind: "member" },
      "lots of lamps",
      () => {},
    );
    expect(result.steps).toHaveLength(4);
    expect(result.text).toContain("stopped");
    await database.close();
  });
});
