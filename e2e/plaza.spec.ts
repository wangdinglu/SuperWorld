import { devices, expect, test, type Page } from "@playwright/test";

async function enter(page: Page, name: string, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByRole("button", { name: "Enter the plaza" }).click();
  // Generous: CI renders in software and compiles shaders on first load.
  await expect(page.locator(".hud")).toBeVisible({ timeout: 60_000 });
}

test("a laptop and a phone meet in the plaza", async ({ browser }) => {
  const laptop = await browser.newPage();
  const phoneContext = await browser.newContext({ ...devices["Pixel 7"] });
  const phone = await phoneContext.newPage();

  await enter(laptop, "Laptop");
  await enter(phone, "Phone");

  // Each sees two people here, and the other's name tag.
  await expect(laptop.getByRole("button", { name: "2 here" })).toBeVisible({ timeout: 15_000 });
  await expect(phone.getByRole("button", { name: "2 here" })).toBeVisible({ timeout: 15_000 });
  await expect(laptop.locator(".tag-name", { hasText: "Phone" })).toHaveCount(1);

  // The phone gets touch controls; the laptop doesn't.
  await expect(phone.locator(".joystick")).toBeVisible();
  await expect(laptop.locator(".joystick")).toHaveCount(0);

  // Chat reaches the other player.
  await laptop.keyboard.press("Enter");
  await laptop.getByPlaceholder("Say something…").fill("hello from the laptop");
  await laptop.keyboard.press("Enter");
  await expect(phone.locator(".chatlog")).toContainText("hello from the laptop", {
    timeout: 10_000,
  });

  // Both start as the default avatar; the laptop switches, and the phone sees the change.
  type Hook = { __superworld: { avatars(): Record<string, string> } };
  const shownOnPhone = () =>
    phone.evaluate(() => (window as unknown as Hook).__superworld.avatars().Laptop);
  await expect.poll(shownOnPhone, { timeout: 30_000 }).toBe("sprout");
  await laptop.getByRole("button", { name: "Avatar", exact: true }).click();
  await laptop.getByRole("radio", { name: /Inky/ }).click();
  await expect.poll(shownOnPhone, { timeout: 30_000 }).toBe("inky");

  await phoneContext.close();
  await laptop.close();
});

test("walking moves the avatar on the server", async ({ browser }) => {
  // Headless Chromium renders in software; a small low-tier view keeps the frame rate usable.
  const page = await browser.newPage({ viewport: { width: 360, height: 240 } });
  await enter(page, "Walker", "?tier=low");
  const before = await page.evaluate(() =>
    (window as unknown as { __superworld: { me(): { x: number; z: number } } }).__superworld.me(),
  );
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(3000);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);
  const after = await page.evaluate(() =>
    (window as unknown as { __superworld: { me(): { x: number; z: number } } }).__superworld.me(),
  );
  const stats = await page.evaluate(() =>
    (
      window as unknown as { __superworld: { inputs(): unknown; fps?: () => number } }
    ).__superworld.inputs(),
  );
  const focus = await page.evaluate(() => document.activeElement?.tagName);
  expect(
    Math.hypot(after.x - before.x, after.z - before.z),
    `inputs ${JSON.stringify(stats)}, focus ${focus}`,
  ).toBeGreaterThan(0.5);
});
