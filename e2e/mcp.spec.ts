import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("a player approves an outside AI app on the consent screen", async ({ browser, baseURL }) => {
  // The app registers itself and starts OAuth, as an MCP client would.
  const registered = await fetch(`${baseURL}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Desk Builder",
      redirect_uris: ["http://localhost:7777/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const { client_id } = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${baseURL}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: "http://localhost:7777/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "xyz",
  }).toString();
  const redirect = await fetch(authorize, { redirect: "manual" });
  const consentUrl = redirect.headers.get("location")!;
  expect(consentUrl).toContain("mcp=");

  const page = await browser.newPage({ viewport: { width: 480, height: 600 } });
  await page.goto(`${consentUrl}&tier=low`);
  await page.getByPlaceholder("Your name").fill("Approver");
  await page.getByRole("button", { name: "Enter the plaza" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect an AI app" });
  await expect(dialog).toContainText("Desk Builder wants to build in your SuperWorld spaces", {
    timeout: 60_000,
  });
  const callback = page.waitForRequest((r) => r.url().startsWith("http://localhost:7777/"));
  await dialog.getByRole("button", { name: "Allow" }).click();
  const back = new URL((await callback).url());
  expect(back.searchParams.get("state")).toBe("xyz");
  const code = back.searchParams.get("code")!;

  // The app swaps the code for tokens.
  const tokens = await fetch(`${baseURL}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id,
      redirect_uri: "http://localhost:7777/callback",
    }),
  });
  expect(((await tokens.json()) as { token_type: string }).token_type).toBe("bearer");
  await page.close();
});
