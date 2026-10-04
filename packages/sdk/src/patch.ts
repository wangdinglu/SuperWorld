/**
 * A small RFC 6902 JSON Patch implementation (add, remove, replace, test) over plain JSON values.
 * Every edit to a scene, from any door (player, agent, MCP, CLI), is a list of these operations.
 */
export type PatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "test"; path: string; value: unknown };

export class PatchError extends Error {}

function parsePath(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new PatchError(`Invalid path "${path}"`);
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

// Scenes are plain JSON, so a JSON round trip is a faithful deep copy (and works on every runtime).
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function container(doc: unknown, parts: string[]): unknown {
  let node = doc;
  for (const key of parts) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (node && typeof node === "object") node = (node as Record<string, unknown>)[key];
    else throw new PatchError(`Path not found: /${parts.join("/")}`);
    if (node === undefined) throw new PatchError(`Path not found: /${parts.join("/")}`);
  }
  return node;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Applies a patch to a copy of `doc`. Throws PatchError (and leaves `doc` untouched) on failure. */
export function applyPatch<T>(doc: T, ops: readonly PatchOp[]): T {
  let out = clone(doc) as unknown;
  for (const op of ops) {
    const parts = parsePath(op.path);
    if (parts.length === 0) {
      if (op.op === "test") {
        if (!equal(out, op.value)) throw new PatchError("Test failed at root");
        continue;
      }
      if (op.op === "remove") throw new PatchError("Can't remove the document root");
      out = clone(op.value);
      continue;
    }
    const key = parts[parts.length - 1]!;
    const parent = container(out, parts.slice(0, -1));
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0) throw new PatchError(`Bad array index "${key}"`);
      switch (op.op) {
        case "add":
          if (index > parent.length) throw new PatchError(`Index ${index} out of range`);
          parent.splice(index, 0, clone(op.value));
          break;
        case "remove":
          if (index >= parent.length) throw new PatchError(`Index ${index} out of range`);
          parent.splice(index, 1);
          break;
        case "replace":
          if (index >= parent.length) throw new PatchError(`Index ${index} out of range`);
          parent[index] = clone(op.value);
          break;
        case "test":
          if (!equal(parent[index], op.value)) throw new PatchError(`Test failed at ${op.path}`);
          break;
      }
    } else if (parent && typeof parent === "object") {
      const obj = parent as Record<string, unknown>;
      switch (op.op) {
        case "add":
          obj[key] = clone(op.value);
          break;
        case "remove":
          if (!(key in obj)) throw new PatchError(`Path not found: ${op.path}`);
          delete obj[key];
          break;
        case "replace":
          if (!(key in obj)) throw new PatchError(`Path not found: ${op.path}`);
          obj[key] = clone(op.value);
          break;
        case "test":
          if (!equal(obj[key], op.value)) throw new PatchError(`Test failed at ${op.path}`);
          break;
      }
    } else {
      throw new PatchError(`Path not found: ${op.path}`);
    }
  }
  return out as T;
}
