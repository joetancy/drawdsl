import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "web-tests",
    fullyParallel: true,
    retries: 0,
    use: {
        baseURL: "http://localhost:4173/drawdsl/",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run web:preview -- --port 4173 --strictPort",
        url: "http://localhost:4173/drawdsl/",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
