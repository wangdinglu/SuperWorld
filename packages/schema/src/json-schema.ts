import { z } from "zod";
import { Scene } from "./scene.ts";
import { TemplateLibrary } from "./template.ts";
import { World } from "./world.ts";

/** JSON Schema for each document, for editors, the MCP server and agent tool definitions. */
export function jsonSchemas(): Record<string, unknown> {
  return {
    "superworld.world/1": z.toJSONSchema(World, { io: "input" }),
    "superworld.scene/1": z.toJSONSchema(Scene, { io: "input" }),
    "superworld.templates/1": z.toJSONSchema(TemplateLibrary, { io: "input" }),
  };
}
