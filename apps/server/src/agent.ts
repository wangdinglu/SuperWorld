import Anthropic from "@anthropic-ai/sdk";
import type { Scene } from "@superworld/schema";
import { toolDefinitions } from "@superworld/sdk";
import type { SpaceEditor } from "./editors.ts";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The one call the agent needs. Production wraps the Anthropic SDK; tests script responses. */
export interface MessagesClient {
  create(params: CreateParams): Promise<BetaMessage>;
}

export interface AgentConfig {
  model: string;
  /** Tool-use rounds per request before the agent stops and reports. */
  maxRounds: number;
  /** Requests per player per UTC day. */
  dailyLimit: { guest: number; member: number };
}

export interface AgentProgress {
  state: "thinking" | "working";
  step?: string;
}

export interface AgentReply {
  text: string;
  steps: string[];
  error?: string;
}

const SYSTEM_PROMPT = `You are the building assistant in SuperWorld, a shared 3D world. You help the owner of a private space build it by calling tools. Each tool call is one step the owner watches happen live; they can undo any step and they decide when to save.

How the space works:
- The ground is a flat disc centred on (0, 0). Positions are x and z in metres; keep everything inside the ground radius (leave about a metre at the edge). Visitors arrive at the spawn point; keep a clear path around it.
- Objects come from a small library of templates (call library_list_templates if you need the ids). Rotation is in degrees; 0 faces +z. Scale changes size (0.25 to 4).
- Style topics (form, surface, colour palette, light, atmosphere) change the whole space's look.
- There are limits on object count and detail. If a tool returns an error, read it and adjust rather than repeating the same call.

How to work:
- Act on the owner's request directly. Make sensible creative choices instead of asking questions, unless the request is genuinely unclear.
- Lay things out with intent: groups, paths, symmetry or deliberate clusters, and spacing so objects don't overlap (benches ~2 m wide, trees ~3.5 m, fountains ~10 m).
- Check the current objects with scene_list_objects before moving or removing things you didn't place yourself in this conversation.
- When you're done, reply in one to three short sentences: what you built, and that they can Undo or Save. No lists, no markdown.`;

/** Turns the live draft into a one-paragraph briefing for the start of a request. */
function briefing(scene: Scene): string {
  const counts = new Map<string, number>();
  for (const i of scene.instances) counts.set(i.template, (counts.get(i.template) ?? 0) + 1);
  const objects = [...counts].map(([t, n]) => `${n}× ${t}`).join(", ") || "nothing yet";
  const style =
    Object.entries(scene.style)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ") || "world default";
  const [sx, , sz] = scene.spawn[0]!.at;
  return `Current space: ground radius ${scene.environment.ground.radius} m, spawn at (${sx}, ${sz}), style ${style}. Objects: ${objects}.`;
}

/**
 * The building agent: a Claude tool-use loop over the Creator SDK, acting on one space's shared
 * draft as its owner. Conversation history is kept per space so follow-ups ("make it warmer") work.
 */
export class BuildingAgent {
  private readonly tools = toolDefinitions();
  private readonly conversations = new Map<
    string,
    { messages: BetaMessageParam[]; lastUsed: number }
  >();
  private readonly busy = new Set<string>();
  private readonly usage = new Map<string, { day: string; count: number }>();

  constructor(
    private readonly client: MessagesClient,
    private readonly config: AgentConfig,
  ) {}

  /** Builds the agent from environment variables, or returns undefined when it isn't configured. */
  static fromEnv(): BuildingAgent | undefined {
    const model = process.env.AGENT_MODEL;
    if (!model || !process.env.ANTHROPIC_API_KEY) return undefined;
    const anthropic = new Anthropic();
    return new BuildingAgent(
      { create: (params) => anthropic.beta.messages.create(params) },
      {
        model,
        maxRounds: Number(process.env.AGENT_MAX_ROUNDS ?? 16),
        dailyLimit: {
          guest: Number(process.env.AGENT_DAILY_LIMIT_GUEST ?? 10),
          member: Number(process.env.AGENT_DAILY_LIMIT_MEMBER ?? 40),
        },
      },
    );
  }

  /** Counts one request against today's quota. Returns false when the player is out. */
  private takeQuota(userId: string, kind: "guest" | "member", now = new Date()): boolean {
    const day = now.toISOString().slice(0, 10);
    const entry = this.usage.get(userId);
    const count = entry?.day === day ? entry.count : 0;
    if (count >= this.config.dailyLimit[kind]) return false;
    this.usage.set(userId, { day, count: count + 1 });
    return true;
  }

  forget(placeId: string): void {
    this.conversations.delete(placeId);
  }

  /** Runs one request from the space's owner. Progress callbacks fire as the agent works. */
  async run(
    editor: SpaceEditor,
    user: { id: string; kind: "guest" | "member" },
    request: string,
    onProgress: (p: AgentProgress) => void,
  ): Promise<AgentReply> {
    const placeId = editor.placeId;
    if (this.busy.has(placeId))
      return { text: "", steps: [], error: "I'm still working on the last request." };
    if (!this.takeQuota(user.id, user.kind)) {
      const hint = user.kind === "guest" ? " Keep your account to get more." : "";
      return { text: "", steps: [], error: `You've used today's AI building requests.${hint}` };
    }
    this.busy.add(placeId);
    try {
      return await this.loop(editor, request, onProgress);
    } catch (err) {
      console.error(JSON.stringify({ event: "agent-error", place: placeId, error: String(err) }));
      const message =
        err instanceof Anthropic.RateLimitError
          ? "The AI builder is busy right now. Try again in a minute."
          : err instanceof Anthropic.APIError && err.status >= 500
            ? "The AI service had a problem. Try again shortly."
            : "Something went wrong with the AI builder.";
      return { text: "", steps: [], error: message };
    } finally {
      this.busy.delete(placeId);
    }
  }

  private async loop(
    editor: SpaceEditor,
    request: string,
    onProgress: (p: AgentProgress) => void,
  ): Promise<AgentReply> {
    const placeId = editor.placeId;
    const now = Date.now();
    let convo = this.conversations.get(placeId);
    // Start fresh after 30 idle minutes or a long history (keeps requests small and cheap).
    if (!convo || now - convo.lastUsed > 30 * 60_000 || convo.messages.length > 60) {
      convo = { messages: [], lastUsed: now };
      this.conversations.set(placeId, convo);
    }
    convo.lastUsed = now;
    // History is append-only: earlier turns are never edited (required for reasoning to carry over).
    convo.messages.push({
      role: "user",
      content: `${briefing(editor.scene)}\n\nOwner's request: ${request.slice(0, 1000)}`,
    });

    const steps: string[] = [];
    onProgress({ state: "thinking" });
    for (let round = 0; round < this.config.maxRounds; round++) {
      const response = await this.client.create({
        model: this.config.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: this.tools as unknown as CreateParams["tools"],
        messages: convo.messages,
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as CreateParams);
      console.log(
        JSON.stringify({
          event: "agent-usage",
          place: placeId,
          model: response.model,
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
          stop: response.stop_reason,
        }),
      );

      if (response.stop_reason === "refusal") {
        // Don't keep a refused turn: the next request starts from the last good state.
        convo.messages.pop();
        return {
          text: "",
          steps,
          error: "I can't help build that. Try describing it differently.",
        };
      }
      convo.messages.push({
        role: "assistant",
        content: response.content as BetaContentBlock[] as never,
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        return {
          text:
            text || (steps.length ? "Done. You can Undo or Save." : "I didn't change anything."),
          steps,
        };
      }

      // All tool results go back in one user message (keeps parallel tool use working).
      const results: BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        onProgress({ state: "working", step: use.name });
        const result = editor.call(use.name, use.input, "agent");
        if (result.ok) {
          if (result.changed) steps.push(result.summary);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(
              result.output === undefined ? { ok: true, summary: result.summary } : result.output,
            ),
          });
        } else {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: result.error,
            is_error: true,
          });
        }
      }
      convo.messages.push({ role: "user", content: results });
    }
    return {
      text: `I made ${steps.length} changes and stopped to let you look. Ask me to continue if you'd like more.`,
      steps,
    };
  }
}
