import { defineConfig, devices } from "@playwright/test";

// Visual-regression harness for the Dynamic Island (T0-HARNESS).
//
// Baseline separation: webkit is the macOS primary (SF Pro/SF Mono + WKWebView
// parity). The snapshot path carries {projectName} AND {platform}, so
// webkit-darwin, chromium-darwin, and chromium-win32 baselines never share a
// file. webkit + chromium both run per-PR on the macOS runner; the Windows
// chromium baseline (chromium-win32) is generated on a Windows runner and, per
// the CI-budget default, exercised nightly rather than per-PR.
// Vite serves the shape harness (e2e/harness/island.html) so its screenshots
// exercise the real ported TS modules. Vite's strictPort:1420 (vite.config.ts) is the fixed URL.
// Vite binds to localhost (IPv6 ::1), not IPv4 127.0.0.1 - use the hostname.
const HARNESS_PORT = 1420;
export const HARNESS_URL = `http://localhost:${HARNESS_PORT}/e2e/harness/island.html`;

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}-{platform}/{testFileName}/{arg}{ext}",
  forbidOnly: !!process.env.CI,
  use: {
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
  webServer: [
    {
      command: "pnpm vite",
      url: HARNESS_URL,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
