import { z } from "zod";
import { TOOLS } from "./tools.ts";

/**
 * Tool definitions for Claude's Messages API (and other JSON-Schema consumers such as MCP),
 * generated from the one registry. Sorted by name so the list is byte-stable for prompt caching.
 */
export function toolDefinitions(): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}[] {
  return [...TOOLS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const schema = z.toJSONSchema(t.input as z.ZodType, { io: "input" }) as Record<
        string,
        unknown
      >;
      delete schema.$schema;
      return { name: t.name, description: t.description, input_schema: schema };
    });
}
