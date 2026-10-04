import templatesJson from "../../../../content/world/templates.json";
import type { Game } from "../game.ts";
import { equipped, inventory } from "../store.ts";

const names = new Map(
  (templatesJson.templates as { id: string; name: string }[]).map((t) => [t.id, t.name]),
);
const nameOf = (id: string) => names.get(id) ?? id;

/** What I carry: hold or wear any of it, in any place. */
export function BagPanel(props: { game: Game; onClose: () => void }) {
  const { game } = props;
  const { hand, head } = equipped.value;
  return (
    <div class="card panel bag">
      <div class="row spread">
        <h2>Bag</h2>
        <button class="link" onClick={props.onClose} aria-label="Close bag">
          ✕
        </button>
      </div>
      {(hand || head) && (
        <div class="row">
          {hand && (
            <button class="secondary" onClick={() => game.unequip("hand")}>
              Put away the {nameOf(hand).toLowerCase()}
            </button>
          )}
          {head && (
            <button class="secondary" onClick={() => game.unequip("head")}>
              Take off the {nameOf(head).toLowerCase()}
            </button>
          )}
        </div>
      )}
      {inventory.value.length === 0 ? (
        <p class="muted-text">
          Empty. Find things to take around the world, like balls, hats and lanterns.
        </p>
      ) : (
        <ul>
          {[...inventory.value].reverse().map((item) => (
            <li key={item}>
              <span class="grow">{nameOf(item)}</span>
              <button
                class="link"
                disabled={item === hand || item === head}
                onClick={() => game.equip(item)}
              >
                {item === hand || item === head ? "In use" : "Use"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
