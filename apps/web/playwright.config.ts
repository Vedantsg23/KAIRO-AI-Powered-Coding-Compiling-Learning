import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real stack: browser -> Vite -> API -> runner -> Docker.
// Start the API and the runner first (see README), then: npm run e2e
//
// Locally the tests use the dev server (`npm run dev`, reused if it is already
// running). On CI they run against the production build served by `vite preview`:
// the same bundle the live site serves, without the dev server's on-demand
// transforms (on CI those twice left Monaco's files unanswered for minutes).
// VITE_E2E=1 makes that build expose the editor handle the tests use; real
// production builds do not.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // On CI a failed test runs once more; a real failure fails again and is reported.
  retries: ci ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: ci ? "npx vite build && npx vite preview --port 5173 --strictPort" : "npm run dev",
    env: ci ? { VITE_E2E: "1" } : {},
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: ci ? 300_000 : 60_000,
    // Keep the web server's own log in the CI output.
    stdout: ci ? "pipe" : "ignore",
  },
});
