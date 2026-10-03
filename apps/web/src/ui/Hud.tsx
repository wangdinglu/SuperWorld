import { useEffect, useRef, useState } from "preact/hooks";
import { CHAT_MAX, EMOTES, type Emote } from "@superworld/protocol";
import type { Game } from "../game.ts";
import {
  cameraLevel,
  chatLog,
  chatOpen,
  hint,
  muted,
  people,
  personKey,
  ping,
  renderInfo,
  soloMode,
  toggleMute,
} from "../store.ts";
import { Joystick } from "./Joystick.tsx";
import { AccountPanel } from "./AccountPanel.tsx";
import { account } from "../account.ts";

const EMOTE_LABEL: Record<Emote, string> = {
  wave: "👋 Wave",
  dance: "💃 Dance",
  cheer: "🙌 Cheer",
  sit: "🪑 Sit",
};
const touch = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export function Hud(props: { game: Game }) {
  const { game } = props;
  const [showPeople, setShowPeople] = useState(false);
  const [showEmotes, setShowEmotes] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [draft, setDraft] = useState("");
  const chatInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatOpen.value) chatInput.current?.focus();
  }, [chatOpen.value]);

  const recent = chatLog.value.slice(-6);
  const info = renderInfo.value;

  return (
    <div class="hud">
      <div class="topbar">
        <div class="pill strong">{soloMode.value ? "Plaza · solo practice" : "Plaza"}</div>
        <button class="pill" onClick={() => setShowPeople(!showPeople)} aria-expanded={showPeople}>
          {people.value.length + 1} here
        </button>
        {ping.value > 0 && <div class="pill muted-text">{ping.value} ms</div>}
        {info && (
          <div class="pill muted-text small">
            {info.backend} · {info.tier}
          </div>
        )}
        {!soloMode.value && (
          <button
            class="pill"
            onClick={() => setShowAccount(!showAccount)}
            aria-expanded={showAccount}
          >
            {account.value?.user.kind === "member" ? "Account" : "Keep my account"}
          </button>
        )}
      </div>

      {showAccount && <AccountPanel onClose={() => setShowAccount(false)} />}

      {showPeople && !showAccount && (
        <div class="card panel people">
          <h2>People nearby</h2>
          {people.value.length === 0 && (
            <p class="muted-text">Nobody else nearby yet. Share the link!</p>
          )}
          <ul>
            {people.value.map((p) => {
              const isMuted = muted.value.includes(personKey(p));
              return (
                <li key={p.sessionId}>
                  <span class="dot" style={{ background: p.colour }} />
                  <span class="grow">{p.name}</span>
                  <button class="link" onClick={() => toggleMute(p)}>
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    class="link danger"
                    onClick={() => {
                      game.report(p.sessionId, "Reported from the people panel");
                      alert(`Thanks. ${p.name} has been reported.`);
                    }}
                  >
                    Report
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            class="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(
                `${location.origin}${location.pathname}${location.search}`,
              );
              alert("Link copied. Send it to a friend!");
            }}
          >
            Copy invite link
          </button>
        </div>
      )}

      {hint.value && <div class="toast">{hint.value}</div>}

      <div class="chatlog" aria-live="polite">
        {recent.map((m) => (
          <div key={m.id} class={`line${m.mine ? " mine" : ""}`}>
            <b>{m.name}</b> {m.text}
          </div>
        ))}
      </div>

      {chatOpen.value ? (
        <form
          class="chatbar"
          onSubmit={(e) => {
            e.preventDefault();
            game.sendChat(draft);
            setDraft("");
            chatOpen.value = false;
          }}
        >
          <input
            ref={chatInput}
            value={draft}
            maxLength={CHAT_MAX}
            placeholder="Say something…"
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Escape" && (chatOpen.value = false)}
            onBlur={() => !draft && (chatOpen.value = false)}
          />
          <button class="primary" type="submit">
            Send
          </button>
        </form>
      ) : null}

      <div class="actions">
        {showEmotes && (
          <div class="emotes card">
            {EMOTES.map((e) => (
              <button
                key={e}
                onClick={() => {
                  game.emote(e);
                  setShowEmotes(false);
                }}
              >
                {EMOTE_LABEL[e]}
              </button>
            ))}
          </div>
        )}
        <button class="round" aria-label="Chat" onClick={() => (chatOpen.value = !chatOpen.value)}>
          💬
        </button>
        <button
          class="round"
          aria-label="Emotes"
          aria-expanded={showEmotes}
          onClick={() => setShowEmotes(!showEmotes)}
        >
          🙂
        </button>
        <button
          class="round"
          aria-label={cameraLevel.value === "walk" ? "Overview camera" : "Walk camera"}
          onClick={() => game.toggleLevel()}
        >
          {cameraLevel.value === "walk" ? "🗺️" : "🚶"}
        </button>
        {touch && (
          <button
            class="round big"
            aria-label="Jump"
            onPointerDown={() => game.controls.queueJump()}
          >
            ⤒
          </button>
        )}
      </div>

      {touch && <Joystick onChange={(x, y) => game.controls.setStick(x, y)} />}
    </div>
  );
}
