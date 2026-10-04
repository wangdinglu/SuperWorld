import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { createSpace, type Db, getPlace, listSpaces, type User } from "@superworld/db";
import { SpaceId } from "@superworld/protocol";
import { TOOLS } from "@superworld/sdk";
import type { Application, Request, Response } from "express";
import { z } from "zod";
import type { SpaceEditors } from "./editors.ts";
import { maskText } from "./moderation.ts";
import { newSpaceId, SPACE_LIMIT, starterScene } from "./spaces.ts";

const SCOPE = "spaces";
const PENDING_MS = 10 * 60_000;
const CODE_MS = 5 * 60_000;
const ACCESS_S = 60 * 60;
const REFRESH_MS = 30 * 24 * 3600_000;

const secret = () => randomBytes(24).toString("base64url");

interface Pending {
  client: OAuthClientInformationFull;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  expires: number;
}
interface Grant {
  clientId: string;
  userId: string;
  expires: number;
}

/**
 * OAuth for the MCP door. Clients register themselves; the player approves them on a consent
 * screen in the web client (signed in as themselves), and tokens let the client act as that
 * player on their spaces only. Kept in memory: a restart signs MCP clients out, which is fine
 * while the door is internal.
 */
export class McpOAuth implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pending = new Map<string, Pending>();
  private readonly codes = new Map<string, Grant & { pending: Pending }>();
  private readonly access = new Map<string, Grant>();
  private readonly refresh = new Map<string, Grant>();

  /** `consentUrl` is the web client; it gets `?mcp=<request>` and asks the player. */
  constructor(private readonly consentUrl: string) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (id) => this.clients.get(id),
      registerClient: (client) => {
        const full = {
          ...client,
          client_id: `mcp-${secret()}`,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        } as OAuthClientInformationFull;
        this.clients.set(full.client_id, full);
        return full;
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: { state?: string; codeChallenge: string; redirectUri: string },
    res: Response,
  ): Promise<void> {
    const id = secret();
    this.pending.set(id, {
      client,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      ...(params.state !== undefined ? { state: params.state } : {}),
      expires: Date.now() + PENDING_MS,
    });
    const url = new URL(this.consentUrl);
    url.searchParams.set("mcp", id);
    res.redirect(url.toString());
  }

  /** What the consent screen shows. */
  describe(requestId: string): { clientName: string } | undefined {
    const p = this.pending.get(requestId);
    if (!p || p.expires < Date.now()) return undefined;
    return { clientName: p.client.client_name ?? "An app" };
  }

  /** The player's answer. Returns where to send the browser back to (the client's redirect). */
  answer(requestId: string, user: User, allow: boolean): string | undefined {
    const p = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (!p || p.expires < Date.now()) return undefined;
    const url = new URL(p.redirectUri);
    if (allow) {
      const code = secret();
      this.codes.set(code, {
        clientId: p.client.client_id,
        userId: user.id,
        expires: Date.now() + CODE_MS,
        pending: p,
      });
      url.searchParams.set("code", code);
    } else {
      url.searchParams.set("error", "access_denied");
    }
    if (p.state !== undefined) url.searchParams.set("state", p.state);
    return url.toString();
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ): Promise<string> {
    const grant = this.codes.get(code);
    if (!grant || grant.clientId !== client.client_id) throw new InvalidGrantError("Unknown code");
    return grant.pending.codeChallenge;
  }

  private issue(clientId: string, userId: string): OAuthTokens {
    const accessToken = secret();
    const refreshToken = secret();
    this.access.set(accessToken, { clientId, userId, expires: Date.now() + ACCESS_S * 1000 });
    this.refresh.set(refreshToken, { clientId, userId, expires: Date.now() + REFRESH_MS });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_S,
      refresh_token: refreshToken,
      scope: SCOPE,
    };
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const grant = this.codes.get(code);
    this.codes.delete(code);
    if (!grant || grant.clientId !== client.client_id || grant.expires < Date.now())
      throw new InvalidGrantError("This code has expired or was already used");
    if (redirectUri && redirectUri !== grant.pending.redirectUri)
      throw new InvalidGrantError("redirect_uri doesn't match");
    return this.issue(client.client_id, grant.userId);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
  ): Promise<OAuthTokens> {
    const grant = this.refresh.get(refreshToken);
    this.refresh.delete(refreshToken);
    if (!grant || grant.clientId !== client.client_id || grant.expires < Date.now())
      throw new InvalidGrantError("Sign in again");
    return this.issue(client.client_id, grant.userId);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = this.access.get(token);
    if (!grant || grant.expires < Date.now()) throw new InvalidTokenError("Invalid or expired");
    return {
      token,
      clientId: grant.clientId,
      scopes: [SCOPE],
      expiresAt: Math.floor(grant.expires / 1000),
      extra: { userId: grant.userId },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    for (const store of [this.access, this.refresh]) {
      const grant = store.get(request.token);
      if (grant?.clientId === client.client_id) store.delete(request.token);
    }
  }
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
});
const fail = (message: string): ToolResult => ({ ...ok(message), isError: true });

export interface McpDeps {
  db: Db;
  editors: SpaceEditors;
  getUser(id: string): Promise<User | undefined>;
}

/**
 * The MCP server for one request, generated from the Creator SDK registry: every SDK tool takes
 * an extra `space` and runs on that space's live draft (actor "mcp"), plus tools to list, create
 * and save spaces. Edits show live to anyone inside, exactly like the build panel's.
 */
export function buildMcpServer(deps: McpDeps, userId: string): McpServer {
  const server = new McpServer({ name: "superworld", version: "1.0.0" });

  async function owned(spaceId: string) {
    const place = await getPlace(deps.db, spaceId);
    if (!place || place.kind !== "space" || place.ownerId !== userId) return undefined;
    return place;
  }

  server.registerTool(
    "spaces_list",
    {
      description:
        "List your SuperWorld spaces (id, name, visibility). Pass a space id to the other tools.",
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      ok(
        (await listSpaces(deps.db, userId)).map((s) => ({
          id: s.id,
          name: s.name,
          visibility: s.visibility,
        })),
      ),
  );

  server.registerTool(
    "space_create",
    {
      description: "Make a new private space with a small starter layout. Returns its id.",
      inputSchema: z.strictObject({ name: z.string().trim().min(1).max(40) }),
    },
    async ({ name }) => {
      const user = await deps.getUser(userId);
      if (!user) return fail("Your account no longer exists.");
      if ((await listSpaces(deps.db, userId)).length >= SPACE_LIMIT[user.kind])
        return fail(`You can have ${SPACE_LIMIT[user.kind]} space(s). Use an existing one.`);
      const id = newSpaceId();
      await createSpace(deps.db, {
        id,
        ownerId: userId,
        name: maskText(name),
        scene: starterScene(id),
      });
      return ok({ id, name: maskText(name) });
    },
  );

  server.registerTool(
    "space_save",
    {
      description:
        "Save the space's draft so visitors see it. Edits are live but unsaved until you call this.",
      inputSchema: z.strictObject({ space: SpaceId }),
    },
    async ({ space }) => {
      if (!(await owned(space))) return fail(`You don't have a space "${space}".`);
      const editor = await deps.editors.get(space);
      const saved = await editor!.save(userId);
      return ok({ saved: true, revision: saved.revision });
    },
  );

  server.registerTool(
    "space_undo",
    {
      description: "Undo the last unsaved change in the space.",
      inputSchema: z.strictObject({ space: SpaceId }),
    },
    async ({ space }) => {
      if (!(await owned(space))) return fail(`You don't have a space "${space}".`);
      const undone = (await deps.editors.get(space))!.undo();
      return ok(undone ? "Undone." : "Nothing to undo.");
    },
  );

  for (const tool of TOOLS) {
    const input = tool.input as unknown as z.ZodObject<z.ZodRawShape>;
    server.registerTool(
      tool.name,
      {
        description: `${tool.description} Pass \`space\`: the id of one of your spaces (spaces_list).`,
        inputSchema: input.extend({ space: SpaceId }),
        annotations: { readOnlyHint: Boolean(tool.readOnly) },
      },
      async (args: Record<string, unknown>) => {
        const { space, ...rest } = args as { space: string } & Record<string, unknown>;
        if (!(await owned(space))) return fail(`You don't have a space "${space}".`);
        const result = (await deps.editors.get(space))!.call(tool.name, rest, "mcp");
        if (!result.ok) return fail(result.error);
        return ok(
          result.output === undefined ? { ok: true, summary: result.summary } : result.output,
        );
      },
    );
  }
  return server;
}

export interface McpDoorOptions extends McpDeps {
  /** This server's public URL (the OAuth issuer and the MCP resource). */
  issuerUrl: string;
  /** The web client, where players approve MCP clients. */
  consentUrl: string;
  requireUser(req: Request, res: Response): Promise<User | undefined>;
}

/** Mounts OAuth endpoints, the consent API and the Streamable HTTP endpoint at /mcp. */
export function registerMcpDoor(app: Application, options: McpDoorOptions): McpOAuth {
  const provider = new McpOAuth(options.consentUrl);
  const issuer = new URL(options.issuerUrl);
  const resource = new URL("/mcp", issuer);
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      resourceServerUrl: resource,
      scopesSupported: [SCOPE],
      resourceName: "SuperWorld spaces",
    }),
  );

  // The consent screen (in the web client) reads the request and answers it as the signed-in player.
  app.get("/api/mcp/consent/:id", (req, res) => {
    const info = provider.describe(String(req.params.id));
    if (!info) return void res.status(410).json({ error: "This request has expired. Try again." });
    res.json(info);
  });
  app.post("/api/mcp/consent/:id", async (req, res) => {
    const user = await options.requireUser(req, res);
    if (!user) return;
    const redirect = provider.answer(String(req.params.id), user, req.body?.allow === true);
    if (!redirect) return void res.status(410).json({ error: "This request has expired." });
    res.json({ redirect });
  });

  const auth = requireBearerAuth({
    verifier: provider,
    requiredScopes: [SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
  });
  // Stateless: a fresh server and transport per request.
  app.post("/mcp", auth, async (req, res) => {
    const userId = String(req.auth?.extra?.userId ?? "");
    const server = buildMcpServer(options, userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (_req: Request, res: Response) =>
    void res.status(405).json({ error: "Use POST (stateless Streamable HTTP)" });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
  return provider;
}
