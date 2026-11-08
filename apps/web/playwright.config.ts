import { defineConfig, devices } from "@playwright/test";

// Ports come from the environment (E2E_WEB_PORT / E2E_API_PORT) so a run can avoid ports something else on the
// machine already uses. Servers are always started fresh: a busy port fails the run instead of silently testing
// whatever answers there. E2E_REUSE=1 reuses servers already running on these ports (your own dev servers).
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8000);
const REUSE = process.env.E2E_REUSE === "1";
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // The first visit of a route compiles it in `next dev`: on a slow runner that alone can exceed the default 5 s.
  expect: { timeout: 20_000 },
  use: { baseURL: WEB_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    {
      command: `uv run uvicorn edith.main:app --port ${API_PORT}`, cwd: "../api", url: `${API_URL}/health`, reuseExistingServer: REUSE, timeout: 60_000,
      env: { EDITH_CORS_ORIGINS: JSON.stringify([WEB_URL]) },
    },
    { command: `npm run dev -- --port ${WEB_PORT}`, url: WEB_URL, reuseExistingServer: REUSE, timeout: 120_000, env: { NEXT_PUBLIC_API_URL: API_URL } },
  ],
});
