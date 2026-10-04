import { useEffect, useState } from "preact/hooks";
import { account, api } from "../account.ts";
import type { Game } from "../game.ts";
import { agentBusy, agentLog, place } from "../store.ts";

interface Draft {
  id: string;
  name: string;
  variant: string;
  buildState: "building" | "ready" | "failed" | null;
  buildNote: string | null;
}
interface Studio {
  agentAvailable: boolean;
  idea: string | null;
  drafts: Draft[];
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await api(path, { ...init, token: account.value!.token });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "That didn't work");
  return body;
}

/** Polls the studio while drafts are being built in the background. */
function useStudio(): [Studio | null, (s: Studio) => void, () => Promise<void>] {
  const [studio, setStudio] = useState<Studio | null>(null);
  const refresh = async () => setStudio(await call<Studio>("/api/studio"));
  useEffect(() => {
    void refresh();
  }, []);
  const building = studio?.drafts.some((d) => d.buildState === "building");
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [building]);
  return [studio, setStudio, refresh];
}

const stateLabel = (d: Draft) =>
  d.buildState === "building" ? "building…" : d.buildState === "failed" ? "failed" : "ready";

/** The creator studio: an idea becomes three drafts to walk through, steer, and keep. */
export function StudioPanel(props: { game: Game; onClose(): void }) {
  const [studio, setStudio] = useStudio();
  const [idea, setIdea] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card panel studio">
      <div class="row spread">
        <h2>✨ Creator studio</h2>
        <button class="link" onClick={props.onClose}>
          Close
        </button>
      </div>
      <p class="muted-text small">
        {studio?.agentAvailable
          ? "Describe an idea. The AI builds three different takes while you walk through them."
          : "Describe an idea. You get three quick sketches of it to walk through (the AI builder isn't set up on this server)."}
      </p>
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setStudio(await call<Studio>("/api/studio/drafts", { body: { idea } }));
            setIdea("");
          });
        }}
      >
        <textarea
          value={idea}
          maxLength={300}
          rows={2}
          placeholder="A moonlit garden with a pond and lanterns…"
          onInput={(e) => setIdea((e.target as HTMLTextAreaElement).value)}
        />
        <button class="primary" type="submit" disabled={busy || idea.trim().length < 3}>
          Make three drafts
        </button>
      </form>
      {studio && studio.drafts.length > 0 && (
        <>
          <p class="small">
            Drafts of <b>{studio.idea}</b>
          </p>
          <ul class="drafts">
            {studio.drafts.map((d) => (
              <li key={d.id}>
                <span class="grow">
                  Draft {d.variant} <span class="muted-text small">· {stateLabel(d)}</span>
                  {d.buildNote && <span class="muted-text small"> · {d.buildNote}</span>}
                </span>
                <button
                  class="link"
                  disabled={busy || place.value?.id === d.id}
                  onClick={() =>
                    void run(async () => {
                      await props.game.goToSpace(d.id);
                      props.onClose();
                    })
                  }
                >
                  {place.value?.id === d.id ? "Here" : "Walk in"}
                </button>
              </li>
            ))}
          </ul>
          <button
            class="link danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await call("/api/studio/drafts", { method: "DELETE" });
                setStudio({ ...studio, drafts: [], idea: null });
                if (place.value?.stage === "draft") await props.game.goToPlaza();
              })
            }
          >
            Discard all drafts
          </button>
        </>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}

/**
 * Shown inside a draft: step along the corridor of drafts, steer this one by talking to the AI,
 * and keep it when it's right.
 */
export function DraftCorridor(props: { game: Game; onOpenStudio(): void }) {
  const [studio] = useStudio();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const p = place.value!;
  const drafts = studio?.drafts ?? [];
  const index = drafts.findIndex((d) => d.id === p.id);
  const here = drafts[index];
  const last = agentLog.value.at(-1);
  const go = (offset: number) => {
    const next = drafts[(index + offset + drafts.length) % drafts.length];
    if (next) void props.game.goToSpace(next.id);
  };

  return (
    <div class="card corridor" role="region" aria-label="Draft corridor">
      <div class="row spread">
        <button class="link" aria-label="Previous draft" onClick={() => go(-1)}>
          ‹
        </button>
        <span class="small">
          <b>Draft {here?.variant ?? "?"}</b> of {drafts.length || 3}
          {here?.buildState === "building" && " · building…"}
        </span>
        <button class="link" aria-label="Next draft" onClick={() => go(1)}>
          ›
        </button>
      </div>
      {p.agentAvailable && (
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || agentBusy.value) return;
            props.game.askAgent(text.trim());
            setText("");
          }}
        >
          <input
            value={text}
            maxLength={1000}
            placeholder="Steer it: “warmer”, “add a pond”…"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
          <button class="secondary" type="submit" disabled={Boolean(agentBusy.value)}>
            Tell
          </button>
        </form>
      )}
      {agentBusy.value ? (
        <p class="muted-text small">The AI is working…</p>
      ) : (
        last?.from === "ai" && <p class="muted-text small">{last.text}</p>
      )}
      <div class="row">
        <button
          class="primary"
          disabled={here?.buildState === "building"}
          onClick={() =>
            void (async () => {
              setError("");
              try {
                await call(`/api/studio/drafts/${p.id}/keep`, { body: {} });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })()
          }
        >
          Keep this one
        </button>
        <button class="secondary" onClick={props.onOpenStudio}>
          Studio
        </button>
      </div>
      {error && <p class="error">{error}</p>}
    </div>
  );
}
