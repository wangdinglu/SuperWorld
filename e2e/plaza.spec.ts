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

test("a player takes a ball, throws it and keeps it in the bag", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
  await enter(page, "Juggler", "?tier=low");
  type Hook = {
    me(): { x: number; z: number; hand: string; seat: string };
    walkTo(x: number, z: number): void;
    props(): number;
    interaction(): string | undefined;
  };
  const hook = <T>(fn: (h: Hook) => T) =>
    page.evaluate(`(${fn.toString()})(window.__superworld)`) as Promise<T>;

  // The ball basket stands near the arrival point.
  await hook((h) => h.walkTo(-4.9, 15));
  await expect.poll(() => hook((h) => h.interaction()), { timeout: 30_000 }).toBe("take");
  await expect(page.getByRole("button", { name: /Take a ball/ })).toBeVisible();
  await page.screenshot({ path: "test-results/items-basket.png" });
  await page.keyboard.press("KeyE");
  await expect.poll(() => hook((h) => h.me().hand), { timeout: 10_000 }).toBe("item/ball");

  await page.getByRole("button", { name: /Throw/ }).click();
  await expect.poll(() => hook((h) => h.props()), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => hook((h) => h.me().hand)).toBe("");

  // The bag remembers the ball.
  await page.getByRole("button", { name: "Bag" }).click();
  await expect(page.locator(".bag")).toContainText("Ball");
  await page.getByRole("button", { name: "Close bag" }).click();

  await page.close();
});
