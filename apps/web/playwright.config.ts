import { defineConfig, devices } from "@playwright/test";

// Ports come from the environment so a run never reuses servers that belong to something else on the machine
// (playwright reuses whatever already answers on these ports).
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8000);
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: WEB_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    {
      command: `uv run uvicorn edith.main:app --port ${API_PORT}`, cwd: "../api", url: `${API_URL}/health`, reuseExistingServer: true, timeout: 60_000,
      env: { EDITH_CORS_ORIGINS: JSON.stringify([WEB_URL]) },
    },
    { command: `npm run dev -- --port ${WEB_PORT}`, url: WEB_URL, reuseExistingServer: true, timeout: 120_000, env: { NEXT_PUBLIC_API_URL: API_URL } },
  ],
});
