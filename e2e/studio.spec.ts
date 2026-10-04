import { expect, test } from "@playwright/test";

test("an idea becomes three drafts; the player walks through them, keeps one and submits it", async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 640, height: 560 } });
  await page.goto("/?tier=low");
  await page.getByPlaceholder("Your name").fill("Dreamer");
  await page.getByRole("button", { name: "Enter the plaza" }).click();
  await expect(page.locator(".hud")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "✨ Studio" }).click();
  await page.getByPlaceholder(/moonlit garden/).fill("a flower garden for picnics");
  await page.getByRole("button", { name: "Make three drafts" }).click();
  const drafts = page.locator(".drafts li");
  await expect(drafts).toHaveCount(3);
  await expect(drafts.nth(0)).toContainText("ready", { timeout: 30_000 });

  await drafts.nth(0).getByRole("button", { name: "Walk in" }).click();
  const corridor = page.getByRole("region", { name: "Draft corridor" });
  await expect(corridor).toContainText("Draft A of 3", { timeout: 30_000 });
  await expect(page.locator(".topbar")).toContainText("a flower garden for picnics · A");

  await corridor.getByRole("button", { name: "Next draft" }).click();
  await expect(corridor).toContainText("Draft B of 3", { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/studio-draft-b.png" });

  await corridor.getByRole("button", { name: "Keep this one" }).click();
  await expect(corridor).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".topbar")).toContainText("a flower garden for picnics");

  await page.getByRole("button", { name: /Build/ }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Submit to the gallery/ }).click();
  await expect(page.locator(".build")).toContainText("In the gallery", { timeout: 15_000 });
  await expect(page.locator(".build")).toContainText("Visibility: public");

  await page.close();
});
