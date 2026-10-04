import { useState } from "preact/hooks";
import { account, api } from "../account.ts";
import type { Game } from "../game.ts";
import { agentBusy, agentLog, editResult, place } from "../store.ts";

const LIBRARY = [
  ["prim/tree", "🌲 Tree"],
  ["prim/bench", "🪑 Bench"],
  ["prim/lamp", "💡 Lamp"],
  ["prim/planter", "🪴 Planter"],
  ["prim/fountain", "⛲ Fountain"],
  ["prim/portal-arch", "🚪 Arch"],
  ["prim/pond", "💧 Pond"],
  ["prim/glass-pavilion", "🔷 Glass pavilion"],
  ["prim/holo-sign", "✨ Hologram"],
  ["prim/statue", "🗿 Statue"],
  ["prim/ball-basket", "⚽ Balls"],
  ["prim/hat-stand", "🎉 Hats"],
  ["prim/lantern-post", "🏮 Lanterns"],
  ["prim/drum", "🥁 Drum"],
  ["prim/chimes", "🎐 Chimes"],
  ["prim/notice-board", "📋 Notice board"],
] as const;

const LIGHTS = ["noon", "golden", "overcast", "neon"] as const;
const FORMS = ["smooth", "lowpoly", "voxel"] as const;
const PALETTES = ["meadow", "dusk", "mint", "candy", "mono"] as const;
const SURFACES = ["soft", "toon", "ink", "pbr"] as const;
const ATMOSPHERES = ["clear", "mist", "stars", "petals"] as const;
const EFFECTS = ["outline", "pixelate", "grain", "bloom"] as const;

/** For a space's owner: place objects in front of you, change the style, undo, and save. */
export function BuildPanel(props: { game: Game; onClose(): void }) {
  const { game } = props;
  const p = place.value!;
  // The space's style as everyone sees it (its own topics over the world's defaults).
  const style = game.currentStyle();
  const [tab, setTab] = useState<"ai" | "add" | "objects" | "style" | "settings">(
    p.agentAvailable ? "ai" : "add",
  );
  const [prompt, setPrompt] = useState("");
  const objects = game.objects();
  const unsaved = p.draftSteps.length;

  const setVisibility = async (visibility: "public" | "private") => {
    await api(`/api/spaces/${p.id}`, {
      method: "PATCH",
      body: { visibility },
      token: account.value!.token,
    });
  };

  return (
    <div class="card panel build">
      <div class="row spread">
        <h2>Build: {p.name}</h2>
        <button class="link" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div class="tabs" role="tablist">
        {(["ai", "add", "objects", "style", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "ai"
              ? "✨ Ask AI"
              : t === "add"
                ? "Add"
                : t === "objects"
                  ? `Objects (${objects.length})`
                  : t === "style"
                    ? "Style"
                    : "Settings"}
          </button>
        ))}
      </div>

      {tab === "ai" && (
        <div class="stack">
          {!p.agentAvailable ? (
            <p class="muted-text">
              The AI builder isn't set up on this server yet. Use the Add tab to build by hand.
            </p>
          ) : (
            <>
              <div class="agent-log" aria-live="polite">
                {agentLog.value.length === 0 && (
                  <p class="muted-text">
                    Describe what you want, like “a cosy reading garden with benches and lamps” or
                    “make it feel like night”. Every change can be undone, and nothing is kept until
                    you press Save.
                  </p>
                )}
                {agentLog.value.map((m) => (
                  <div key={m.id} class={`msg ${m.from}${m.error ? " error" : ""}`}>
                    {m.text}
                    {m.steps && m.steps.length > 0 && (
                      <details>
                        <summary>
                          {m.steps.length} change{m.steps.length === 1 ? "" : "s"}
                        </summary>
                        <ul>
                          {m.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
                {agentBusy.value && (
                  <div class="msg ai busy">
                    {agentBusy.value.state === "thinking"
                      ? "Thinking…"
                      : `Working: ${agentBusy.value.step?.replace(/_/g, " ")}`}
                  </div>
                )}
              </div>
              <form
                class="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = prompt.trim();
                  if (!text || agentBusy.value) return;
                  game.askAgent(text);
                  setPrompt("");
                }}
              >
                <input
                  value={prompt}
                  maxLength={1000}
                  placeholder="What should I build?"
                  onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
                />
                <button
                  class="primary"
                  type="submit"
                  disabled={!prompt.trim() || Boolean(agentBusy.value)}
                >
                  Ask
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {tab === "add" && (
        <div class="grid2">
          {LIBRARY.map(([id, label]) => (
            <button
              key={id}
              class="secondary"
              onClick={() => {
                const spot = game.spotAhead(id);
                game.edit("scene_place_object", {
                  template: id,
                  x: spot.x,
                  z: spot.z,
                  yawDegrees: 0,
                });
              }}
            >
              {label}
            </button>
          ))}
          <p class="muted-text small span2">Objects appear a few steps in front of you.</p>
        </div>
      )}

      {tab === "objects" && (
        <ul class="objects">
          {objects.map((o) => (
            <li key={o.id}>
              <span class="grow">{o.id}</span>
              <button
                class="link"
                onClick={() =>
                  game.edit("scene_move_object", { id: o.id, ...game.spotAhead(o.template) })
                }
              >
                Move here
              </button>
              <button
                class="link danger"
                onClick={() => game.edit("scene_remove_object", { id: o.id })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "style" && (
        <div class="style-picks">
          {(
            [
              ["light", LIGHTS],
              ["form", FORMS],
              ["colour", PALETTES],
              ["surface", SURFACES],
              ["atmosphere", ATMOSPHERES],
            ] as const
          ).map(([topic, options]) => (
            <div key={topic}>
              <span class="label">{topic}</span>
              <div class="opts">
                {options.map((o) => (
                  <button
                    key={o}
                    class="chip"
                    aria-pressed={style[topic] === o}
                    onClick={() => game.edit("style_set", { [topic]: o })}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div>
            <span class="label">effects</span>
            <div class="opts">
              {EFFECTS.map((e) => {
                const on = style.postEffects.includes(e);
                return (
                  <button
                    key={e}
                    class="chip"
                    aria-pressed={on}
                    onClick={() =>
                      game.edit("style_set", {
                        postEffects: on
                          ? style.postEffects.filter((x) => x !== e)
                          : [...style.postEffects, e],
                      })
                    }
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div class="stack">
          <p>
            Visibility: <b>{p.visibility}</b>
          </p>
          <div class="row">
            <button class="secondary" onClick={() => setVisibility("public")}>
              Make public
            </button>
            <button class="secondary" onClick={() => setVisibility("private")}>
              Make private
            </button>
          </div>
          <p class="muted-text small">
            Private spaces need a knock; you let visitors in while you're inside.
          </p>
          <button
            class="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(location.href);
              alert("Link to this space copied.");
            }}
          >
            Copy link to this space
          </button>
        </div>
      )}

      {editResult.value && (
        <p class={editResult.value.ok ? "notice" : "error"}>{editResult.value.text}</p>
      )}

      <div class="row spread">
        <span class="muted-text small">
          {unsaved === 0
            ? "All changes saved"
            : `${unsaved} unsaved change${unsaved === 1 ? "" : "s"}`}
        </span>
        <div class="row">
          <button class="secondary" disabled={unsaved === 0} onClick={() => game.undo()}>
            Undo
          </button>
          <button class="primary" disabled={unsaved === 0} onClick={() => game.saveDraft()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
