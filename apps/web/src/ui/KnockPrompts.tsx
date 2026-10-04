import { account, api } from "../account.ts";
import type { Game } from "../game.ts";
import { knocks, travel } from "../store.ts";

/** Knocking: as a visitor at a private space's door, and as the owner hearing a knock. */
export function KnockPrompts(props: { game: Game }) {
  const t = travel.value;
  return (
    <>
      {t.state === "travelling" && <div class="toast">Going to {t.to}…</div>}
      {t.state === "knock" && (
        <div class="card panel knock">
          <h2>This space is private</h2>
          <p>Knock, and the owner can let you in if they're inside.</p>
          <div class="row">
            <button
              class="primary"
              onClick={async () => {
                travel.value = { state: "knocking", spaceId: t.spaceId };
                const res = await api(`/api/spaces/${t.spaceId}/knock`, {
                  body: {},
                  token: account.value!.token,
                });
                const body = (await res.json().catch(() => ({}))) as {
                  allowed?: boolean;
                  reason?: string;
                };
                if (body.allowed) await props.game.goToSpace(t.spaceId);
                else
                  travel.value = {
                    state: "denied",
                    message: body.reason ?? "The owner didn't let you in.",
                  };
              }}
            >
              Knock
            </button>
            <button class="secondary" onClick={() => (travel.value = { state: "idle" })}>
              Not now
            </button>
          </div>
        </div>
      )}
      {t.state === "knocking" && <div class="toast">Knocking… waiting for the owner</div>}
      {t.state === "denied" && (
        <div class="card panel knock">
          <p>{t.message}</p>
          <button class="secondary" onClick={() => (travel.value = { state: "idle" })}>
            OK
          </button>
        </div>
      )}
      {knocks.value.map((k) => (
        <div key={k.userId} class="card panel knock owner">
          <p>
            <b>{k.name}</b> is knocking.
          </p>
          <div class="row">
            <button class="primary" onClick={() => props.game.admit(k.userId, true)}>
              Let in
            </button>
            <button class="secondary" onClick={() => props.game.admit(k.userId, false)}>
              Not now
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
