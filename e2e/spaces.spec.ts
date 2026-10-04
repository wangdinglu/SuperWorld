import { expect, test, type Page } from "@playwright/test";

async function enter(page: Page, name: string, url = "/?tier=low"): Promise<void> {
  await page.goto(url);
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByRole("button", { name: "Enter the plaza" }).click();
  await expect(page.locator(".hud")).toBeVisible({ timeout: 60_000 });
}

test("a player makes a space, builds in it, and a friend visits", async ({ browser }) => {
  const owner = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await enter(owner, "Builder");

  await owner.getByRole("button", { name: "Spaces" }).click();
  await owner.getByPlaceholder("Name a new space").fill("Sea Library");
  await owner.getByRole("button", { name: "Create" }).click();
  await expect(owner.locator(".topbar")).toContainText("Sea Library", { timeout: 30_000 });

  await owner.getByRole("button", { name: /Build/ }).click();
  await owner.getByRole("button", { name: "⛲ Fountain" }).click();
  await expect(owner.locator(".build")).toContainText("Placed Fountain");
  await expect(owner.locator(".build")).toContainText("1 unsaved change");
  await owner.getByRole("button", { name: "Save" }).click();
  await expect(owner.locator(".build")).toContainText("All changes saved");

  await owner.getByRole("tab", { name: "Settings" }).click();
  await owner.getByRole("button", { name: "Make public" }).click();
  await expect(owner.locator(".build")).toContainText("Visibility: public");
  await owner.getByRole("tab", { name: /Objects/ }).click();
  await expect(owner.locator(".objects")).toContainText("fountain-1");
  const link = owner.url();
  expect(link).toContain("space=s-");

  // CI renders in software on two cores: shrink the owner's view so the friend's page can load.
  await owner.setViewportSize({ width: 320, height: 240 });
  const friend = await browser.newPage({ viewport: { width: 400, height: 700 } });
  await enter(friend, "Friend", link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(friend.locator(".topbar")).toContainText("Sea Library", { timeout: 30_000 });
  await expect(friend.getByRole("button", { name: "2 here" })).toBeVisible({ timeout: 15_000 });
  // Visitors don't get the build tools.
  await expect(friend.getByRole("button", { name: /Build/ })).toHaveCount(0);

  await friend.close();
  await owner.close();
});
