import { useState } from "preact/hooks";
import { account, requestKeepAccount } from "../account.ts";

/** Lets a guest keep their account (and use it on other devices) by confirming an email address. */
export function AccountPanel(props: { onClose(): void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const user = account.value?.user;

  if (user?.kind === "member") {
    return (
      <div class="card panel">
        <h2>Your account</h2>
        <p>
          Signed in as <b>{user.email}</b>. Your account works on any device: open SuperWorld there
          and sign in with the same email.
        </p>
        <button class="secondary" onClick={props.onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form
      class="card panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        try {
          await requestKeepAccount(email);
          setState("sent");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setState("error");
        }
      }}
    >
      <h2>Keep your account</h2>
      {state === "sent" ? (
        <p>
          Check your email for a sign-in link. Open it on any device to keep your account there.
        </p>
      ) : (
        <>
          <p class="muted-text">
            You're a guest. Add your email to keep your name, colour and (soon) your spaces, and to
            sign in on other devices. We only use it to send sign-in links.
          </p>
          <label class="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              autoComplete="email"
              placeholder="you@example.com"
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </label>
          {state === "error" && <p class="error">{error}</p>}
          <button class="primary" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </>
      )}
      <button type="button" class="link" onClick={props.onClose}>
        Close
      </button>
    </form>
  );
}
