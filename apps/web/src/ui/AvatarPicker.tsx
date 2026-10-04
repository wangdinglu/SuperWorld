import { PALETTES } from "@superworld/style";
import { avatarLibrary, avatarThumbnail } from "../avatars.ts";

/** A card per avatar: its picture, its name, and the style it is drawn in. */
export function AvatarPicker(props: { selected: string; onPick(id: string): void; label: string }) {
  return (
    <div class="avatars" role="radiogroup" aria-label={props.label}>
      {avatarLibrary.avatars.map((a) => {
        const palette = PALETTES[a.style.colour];
        return (
          <button
            type="button"
            key={a.id}
            role="radio"
            aria-checked={a.id === props.selected}
            class="avatar-card"
            title={a.about}
            style={{ "--tint": palette.ground }}
            onClick={() => props.onPick(a.id)}
          >
            <img src={avatarThumbnail(a.id)} alt="" width={96} height={96} loading="lazy" />
            <b>{a.name}</b>
            <span class="avatar-style">
              {a.style.form} · {a.style.surface}
            </span>
            <span class="avatar-palette" aria-label={`${a.style.colour} palette`}>
              {[palette.base, palette.accent, palette.leaf, palette.light].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
