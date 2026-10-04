import { expect, test, type Page } from "@playwright/test";

async function enter(page: Page, name: string, url: string): Promise<void> {
  await page.goto(url);
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByRole("button", { name: "Enter the plaza" }).click();
  await expect(page.locator(".hud")).toBeVisible({ timeout: 60_000 });
}

type Hook = { effects(): string[]; outlines(): boolean };
const hook = <T>(page: Page, fn: (h: Hook) => T) =>
  page.evaluate(`(${fn.toString()})(window.__superworld)`) as Promise<T>;

test("the style mixer restyles a space with materials, outlines, particles and effects", async ({
  browser,
}) => {
  // Medium tier: outlines and grain are on; bloom is high-tier only.
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await enter(page, "Stylist", "/?tier=medium");
  await page.getByRole("button", { name: "Spaces" }).click();
  await page.getByPlaceholder("Name a new space").fill("Glass Garden");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".topbar")).toContainText("Glass Garden", { timeout: 30_000 });

  await page.getByRole("button", { name: /Build/ }).click();
  for (const name of ["💧 Pond", "🔷 Glass pavilion", "✨ Hologram", "🗿 Statue"]) {
    await page.getByRole("button", { name }).click();
    await expect(page.locator(".build")).toContainText("Placed");
  }
  await page.getByRole("tab", { name: "Style" }).click();
  const chip = (topic: string, option: string) =>
    page.locator(".style-picks > div", { hasText: topic }).getByRole("button", { name: option });

  await chip("surface", "ink").click();
  await expect(chip("surface", "ink")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => hook(page, (h) => h.outlines())).toBe(true);

  await chip("atmosphere", "petals").click();
  await chip("light", "golden").click();
  await chip("effects", "grain").click();
  await expect(chip("effects", "grain")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => hook(page, (h) => h.effects())).toEqual(["grain"]);
  // Bloom isn't affordable on this tier: asked for, but skipped.
  await chip("effects", "bloom").click();
  await expect(chip("effects", "bloom")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => hook(page, (h) => h.effects())).toEqual(["grain"]);

  // Close the build panel (the Build button toggles it) to look at the space.
  await page.getByRole("button", { name: /Build/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/style-ink-petals.png" });

  await page.getByRole("button", { name: /Build/ }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  await chip("effects", "pixelate").click();
  await chip("atmosphere", "stars").click();
  await chip("light", "neon").click();
  await chip("surface", "pbr").click();
  await expect.poll(() => hook(page, (h) => h.effects())).toEqual(["grain", "pixelate"]);
  await expect.poll(() => hook(page, (h) => h.outlines())).toBe(false);
  await page.getByRole("button", { name: /Build/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/style-neon-pixel.png" });

  await page.close();
});
