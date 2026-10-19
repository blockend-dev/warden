import { defineConfig } from "@playwright/test";

// Browser e2e against a running `next start` (or `next dev`).
//   BASE_URL   — where the app is served (default http://localhost:3100)
//   PW_CHANNEL — "msedge" | "chrome" to use an installed browser instead of
//                Playwright's bundled Chromium (e.g. where its system
//                libraries can't be installed)
//
// Start the app first:  npm run build --workspace apps/web && PORT=3100 npm run start --workspace apps/web

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
