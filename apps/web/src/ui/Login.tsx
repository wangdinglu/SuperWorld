import { useEffect, useState } from "preact/hooks";
import { account } from "../account.ts";
import { NAME_MAX } from "@superworld/protocol";
import { avatarEntry, avatarLibrary } from "../avatars.ts";
import { load } from "../storage.ts";
import { AvatarPicker } from "./AvatarPicker.tsx";

export const COLOURS = [
  "#f2785c",
  "#f2ae45",
  "#5fae6b",
  "#41c7b6",
  "#6c8cff",
  "#ae92ff",
  "#f57cc0",
  "#4a5160",
];

export function Login(props: {
  busy: boolean;
  error: string;
  notice: string;
  onEnter(name: string, colour: string, avatar: string): void;
  onSolo(name: string, colour: string, avatar: string): void;
}) {
  const [name, setName] = useState(load("name", ""));
  const [colour, setColour] = useState(
    load("colour", COLOURS[Math.floor(Math.random() * COLOURS.length)]!),
  );
  const [avatar, setAvatar] = useState(avatarEntry(load("avatar", avatarLibrary.default)).id);
  // A finished email sign-in fills in the account's name and colour.
  useEffect(() => {
    const user = account.value?.user;
    if (user) {
      setName(user.name);
      setColour(user.colour);
    }
  }, [account.value?.user.id]);

  const valid = name.trim().length > 0;

  return (
    <div class="login-wrap">
      <form
        class="card login"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !props.busy) props.onEnter(name.trim(), colour, avatar);
        }}
      >
        <h1>SuperWorld</h1>
        <p class="lead">
          One shared world, from a link. Pick a name, an avatar and a colour, then step into the
          plaza.
        </p>
        <label class="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            autoComplete="nickname"
            placeholder="Your name"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            autoFocus
          />
        </label>
        <div class="field">
          <span id="avatar-label">Avatar</span>
          <AvatarPicker label="Avatar" selected={avatar} onPick={setAvatar} />
          <p class="avatar-about">{avatarEntry(avatar).about}</p>
        </div>
        <div class="field">
          <span id="colour-label">Colour</span>
          <div class="swatches" role="radiogroup" aria-labelledby="colour-label">
            {COLOURS.map((c) => (
              <button
                type="button"
                key={c}
                role="radio"
                aria-checked={c === colour}
                aria-label={c}
                class="swatch"
                style={{ background: c }}
                onClick={() => setColour(c)}
              />
            ))}
          </div>
        </div>
        {props.notice && (
          <p class="notice" role="status">
            {props.notice}
          </p>
        )}
        {account.value?.user.kind === "member" && !props.notice && (
          <p class="notice">Signed in as {account.value.user.email}</p>
        )}
        {props.error && (
          <p class="error" role="alert">
            {props.error}
          </p>
        )}
        <button class="primary" type="submit" disabled={!valid || props.busy}>
          {props.busy ? "Entering…" : "Enter the plaza"}
        </button>
        <button
          type="button"
          class="secondary"
          disabled={!valid || props.busy}
          onClick={() => props.onSolo(name.trim(), colour, avatar)}
        >
          Practice solo (no server needed)
        </button>
        <p class="hint-small">
          WASD or tap to move · drag to look · M for the overview · Enter to chat
        </p>
      </form>
    </div>
  );
}
