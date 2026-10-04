import { useEffect, useState } from "preact/hooks";
import { account, api } from "../account.ts";

/** The pending MCP authorisation from the URL (?mcp=…), read once at load. */
const requestId = new URLSearchParams(location.search).get("mcp");

/**
 * Asks the player whether an outside AI app (an MCP client) may build in their spaces as them.
 * The app is sent back with a one-time code, or with access_denied.
 */
export function McpConsent() {
  const [info, setInfo] = useState<{ clientName: string } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(Boolean(requestId));

  useEffect(() => {
    if (!requestId) return;
    const url = new URL(location.href);
    url.searchParams.delete("mcp");
    history.replaceState(null, "", url.toString());
    void (async () => {
      try {
        const res = await api(`/api/mcp/consent/${requestId}`);
        const body = (await res.json()) as { clientName?: string; error?: string };
        if (!res.ok || !body.clientName) throw new Error(body.error ?? "This request has expired");
        setInfo({ clientName: body.clientName });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  if (!open || !requestId) return null;
  const answer = async (allow: boolean) => {
    try {
      const res = await api(`/api/mcp/consent/${requestId}`, {
        body: { allow },
        token: account.value!.token,
      });
      const body = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok || !body.redirect) throw new Error(body.error ?? "That didn't work");
      location.href = body.redirect;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div class="screen-backdrop">
      <div class="card screen" role="dialog" aria-label="Connect an AI app">
        <h2>Connect an AI app?</h2>
        {error ? (
          <p class="error">{error}</p>
        ) : info ? (
          <p>
            <b>{info.clientName}</b> wants to build in your SuperWorld spaces as{" "}
            <b>{account.value?.user.name}</b>: list and create spaces, place and move objects,
            change styles and save. It can't see or change anything else.
          </p>
        ) : (
          <p class="muted-text">Loading…</p>
        )}
        <div class="row">
          {info && !error && (
            <button class="primary" onClick={() => void answer(true)}>
              Allow
            </button>
          )}
          <button
            class="secondary"
            onClick={() => (info && !error ? void answer(false) : setOpen(false))}
          >
            {info && !error ? "Deny" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
