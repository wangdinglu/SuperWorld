import { defineConfig, devices } from "@playwright/test";

const port = 2600;
// In this cloud container Chromium is pre-installed; elsewhere Playwright's own download is used.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  // One game server and software rendering: run tests one at a time.
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The game server also serves the built client from apps/web/dist.
    command: `pnpm build && PORT=${port} node apps/server/dist/index.js`,
    url: `http://localhost:${port}/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
