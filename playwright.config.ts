import { defineConfig, devices } from "@playwright/test";

// Visual-regression harness for the Dynamic Island (T0-HARNESS).
// Baselines are pixel-compared against the user-approved mockup gallery
// (tasks/dynamic-island-mockup.html, self-contained, no network).
//
// Baseline separation: webkit is the macOS primary (SF Pro/SF Mono + WKWebView
// parity). The snapshot path carries {projectName} AND {platform}, so
// webkit-darwin, chromium-darwin, and chromium-win32 baselines never share a
// file. webkit + chromium both run per-PR on the macOS runner; the Windows
// chromium baseline (chromium-win32) is generated on a Windows runner and, per
// the CI-budget default, exercised nightly rather than per-PR.
const PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}-{platform}/{testFileName}/{arg}{ext}",
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: "reduce",
  },
  expect: {
    // Start loose; tighten once baselines stabilise (T0 known unknown).
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://127.0.0.1:${PORT}/tasks/dynamic-island-mockup.html`,
    reuseExistingServer: !process.env.CI,
  },
});
