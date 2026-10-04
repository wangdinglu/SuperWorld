import { useEffect, useState } from "preact/hooks";
import { account, api } from "../account.ts";
import type { Game } from "../game.ts";
import { place } from "../store.ts";

interface SpaceSummary {
  id: string;
  name: string;
  visibility: "public" | "friends" | "private";
}

/** Your spaces: create one, go to it, or go back to the plaza. */
export function SpacesPanel(props: { game: Game; onClose(): void }) {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [gallery, setGallery] = useState<{ id: string; name: string; ownerName: string | null }[]>(
    [],
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const token = account.value?.token;

  const refresh = async () => {
    const res = await api("/api/spaces", { token: token! });
    if (res.ok) setSpaces((await res.json()) as SpaceSummary[]);
    const shared = await api("/api/gallery");
    if (shared.ok) setGallery((await shared.json()) as typeof gallery);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const go = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card panel spaces">
      <h2>Spaces</h2>
      {place.value?.kind === "space" && (
        <button class="secondary" disabled={busy} onClick={() => go(() => props.game.goToPlaza())}>
          ← Back to the plaza
        </button>
      )}
      {spaces === null ? (
        <p class="muted-text">Loading…</p>
      ) : spaces.length === 0 ? (
        <p class="muted-text">
          You don't have a space yet. Make one, then build it with the build panel.
        </p>
      ) : (
        <ul>
          {spaces.map((s) => (
            <li key={s.id}>
              <span class="grow">
                {s.name} <span class="muted-text small">· {s.visibility}</span>
              </span>
              <button
                class="link"
                disabled={busy || place.value?.id === s.id}
                onClick={() => go(() => props.game.goToSpace(s.id))}
              >
                {place.value?.id === s.id ? "Here" : "Go"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          void go(async () => {
            const res = await api("/api/spaces", { body: { name }, token: token! });
            const body = (await res.json()) as { id?: string; error?: string };
            if (!res.ok || !body.id) throw new Error(body.error ?? "Couldn't make the space");
            await props.game.goToSpace(body.id);
          });
        }}
      >
        <input
          value={name}
          maxLength={40}
          placeholder="Name a new space"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="primary" type="submit" disabled={busy || !name.trim()}>
          Create
        </button>
      </form>
      {error && <p class="error">{error}</p>}
      {gallery.length > 0 && (
        <>
          <h2>Gallery</h2>
          <ul class="gallery">
            {gallery.map((g) => (
              <li key={g.id}>
                <span class="grow">
                  {g.name} <span class="muted-text small">· {g.ownerName ?? "someone"}</span>
                </span>
                <button
                  class="link"
                  disabled={busy || place.value?.id === g.id}
                  onClick={() => go(() => props.game.goToSpace(g.id))}
                >
                  {place.value?.id === g.id ? "Here" : "Visit"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" class="link" onClick={props.onClose}>
        Close
      </button>
    </div>
  );
}
