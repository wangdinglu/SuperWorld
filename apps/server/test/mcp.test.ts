import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { getPublishedScene, openDatabase, seedPlace } from "@superworld/db";
import { createServer } from "../src/app.ts";
import { loadContent } from "../src/content.ts";

const port = 5400 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const content = loadContent();
const database = await openDatabase();
await seedPlace(database.db, {
  id: "plaza",
  kind: "plaza",
  name: "Plaza",
  scene: content.scenes.plaza!,
});
const server = createServer({
  content,
  db: database.db,
  mailer: { sendLoginLink: async () => {} },
  mcp: { issuerUrl: base, consentUrl: "http://localhost:9999/" },
});

beforeAll(async () => {
  await server.listen(port);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
  await database.close();
});

/** An outside MCP client's side of OAuth, remembering what it's given. */
function clientAuth() {
  const state: Record<string, any> = {};
  const provider: OAuthClientProvider = {
    redirectUrl: "http://localhost:7777/callback",
    clientMetadata: {
      client_name: "Test Builder",
      redirect_uris: ["http://localhost:7777/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => state.client,
    saveClientInformation: (c) => void (state.client = c),
    tokens: () => state.tokens,
    saveTokens: (t) => void (state.tokens = t),
    redirectToAuthorization: (url) => void (state.authorizeUrl = url),
    saveCodeVerifier: (v) => void (state.verifier = v),
    codeVerifier: () => state.verifier,
  };
  return { provider, state };
}

async function guestToken(name: string): Promise<string> {
  const res = await fetch(`${base}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, colour: "#22aa88" }),
  });
  return ((await res.json()) as { token: string }).token;
}

/** The player's browser: follows the authorize redirect to the consent screen and answers it. */
async function consent(authorizeUrl: URL, playerToken: string, allow: boolean): Promise<URL> {
  const redirect = await fetch(authorizeUrl, { redirect: "manual" });
  const consentUrl = new URL(redirect.headers.get("location")!);
  expect(consentUrl.origin).toBe("http://localhost:9999");
  const id = consentUrl.searchParams.get("mcp")!;
  const info = await (await fetch(`${base}/api/mcp/consent/${id}`)).json();
  expect(info).toEqual({ clientName: "Test Builder" });
  const answer = await fetch(`${base}/api/mcp/consent/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${playerToken}` },
    body: JSON.stringify({ allow }),
  });
  return new URL(((await answer.json()) as { redirect: string }).redirect);
}

describe("MCP door", () => {
  it("refuses requests without a token and points at its OAuth metadata", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("oauth-protected-resource");
    const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as {
      authorization_endpoint: string;
    };
    expect(meta.authorization_endpoint).toBe(`${base}/authorize`);
  });

  it("lets an outside agent build a room using only MCP, after the player approves it", async () => {
    const player = await guestToken("Remote");
    const { provider, state } = clientAuth();
    const url = new URL(`${base}/mcp`);
    const client = new Client({ name: "test-builder", version: "1.0.0" });

    // First connect: OAuth starts (dynamic registration, then the authorize redirect).
    await expect(
      client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider })),
    ).rejects.toThrow(UnauthorizedError);
    const back = await consent(state.authorizeUrl, player, true);
    const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
    await transport.finishAuth(back.searchParams.get("code")!);
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["spaces_list", "space_create", "space_save", "scene_place_object"]),
    );
    const place = tools.find((t) => t.name === "scene_place_object")!;
    expect(place.inputSchema.required).toEqual(expect.arrayContaining(["space", "template"]));

    const text = (r: any) => JSON.parse(r.content[0].text);
    const created = text(
      await client.callTool({ name: "space_create", arguments: { name: "Remote Room" } }),
    );
    const space = created.id as string;
    expect(
      text(
        await client.callTool({
          name: "scene_place_object",
          arguments: { space, template: "prim/fountain", x: 0, z: -4 },
        }),
      ),
    ).toEqual({ id: "fountain-1" });
    await client.callTool({ name: "style_set", arguments: { space, light: "neon" } });
    const offGround = await client.callTool({
      name: "scene_place_object",
      arguments: { space, template: "prim/bench", x: 150, z: 0 },
    });
    expect(offGround.isError).toBe(true);
    expect(text(await client.callTool({ name: "space_save", arguments: { space } }))).toMatchObject(
      {
        saved: true,
      },
    );
    const scene = await getPublishedScene(database.db, space);
    expect(scene?.style.light).toBe("neon");
    expect(scene?.instances.map((i) => i.id)).toContain("fountain-1");

    // Another player's space is out of reach.
    const otherClient = await guestToken("Other");
    const res = await fetch(`${base}/api/spaces`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${otherClient}` },
      body: JSON.stringify({ name: "Not yours" }),
    });
    const theirs = ((await res.json()) as { id: string }).id;
    const denied = await client.callTool({
      name: "scene_clear",
      arguments: { space: theirs, confirm: true },
    });
    expect(denied.isError).toBe(true);
    await client.close();
  });

  it("tells agents how to build, and runs the creator studio for them", async () => {
    const player = await guestToken("Studio Agent");
    const { provider, state } = clientAuth();
    const url = new URL(`${base}/mcp`);
    const client = new Client({ name: "test-builder", version: "1.0.0" });
    await expect(
      client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider })),
    ).rejects.toThrow(UnauthorizedError);
    const back = await consent(state.authorizeUrl, player, true);
    const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
    await transport.finishAuth(back.searchParams.get("code")!);
    await client.connect(transport);
    expect(client.getInstructions()).toContain("space_save");

    const text = (r: any) => JSON.parse(r.content[0].text);
    const made = text(
      await client.callTool({ name: "studio_make_drafts", arguments: { idea: "a moonlit pond" } }),
    );
    expect(made.drafts).toHaveLength(3);
    const [a, b] = made.drafts as { space: string; direction: string }[];
    expect(b!.direction).toMatch(/grand/);
    // The agent rebuilds a draft, then the player's choice is kept.
    await client.callTool({
      name: "scene_place_object",
      arguments: { space: a!.space, template: "prim/pond", x: 3, z: 3 },
    });
    const listed = text(await client.callTool({ name: "spaces_list", arguments: {} }));
    expect(listed.drafts).toHaveLength(3);
    const kept = text(
      await client.callTool({
        name: "studio_keep_draft",
        arguments: { space: a!.space, name: "Moon Pond" },
      }),
    );
    expect(kept).toEqual({ id: a!.space, name: "Moon Pond" });
    const after = text(await client.callTool({ name: "spaces_list", arguments: {} }));
    expect(after.spaces.map((s: any) => s.name)).toEqual(["Moon Pond"]);
    expect(after.drafts).toBeUndefined();
    const scene = await getPublishedScene(database.db, a!.space);
    expect(scene?.instances.filter((i) => i.template === "prim/pond").length).toBeGreaterThan(0);
    await client.close();
  });

  it("sends the client back with access_denied when the player says no", async () => {
    const player = await guestToken("Careful");
    const { provider, state } = clientAuth();
    const client = new Client({ name: "test-builder", version: "1.0.0" });
    await expect(
      client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: provider }),
      ),
    ).rejects.toThrow(UnauthorizedError);
    const back = await consent(state.authorizeUrl, player, false);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
  });
});
