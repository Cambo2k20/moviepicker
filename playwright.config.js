import { defineConfig } from "@playwright/test";

const testPort = process.env.PLAYWRIGHT_PORT || "4173";
const testBaseURL = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: testBaseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort}`,
    url: `${testBaseURL}/moviepicker/?design-preview`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "narrow-desktop", use: { viewport: { width: 1142, height: 912 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
