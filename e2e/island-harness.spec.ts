import { test, expect } from "@playwright/test";
import { HARNESS_URL } from "../playwright.config";

// Visual regression for the ported shape generators (T2). Each cell is rendered
// by e2e/harness/island.ts straight from src/lib/notchPath.ts, so a geometry
// regression in the module shifts these pixels. Baselines live beside the
// mockup baselines under the same {projectName}-{platform} template.

const SHAPE_IDS = [
  "notch-compact",
  "notch-expanded",
  "notch-clamped",
  "float-compact",
  "float-expanded",
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS_URL);
});

for (const id of SHAPE_IDS) {
  test(`shape ${id}`, async ({ page }) => {
    await expect(page.locator(`#${id}`)).toHaveScreenshot(`shape-${id}.png`);
  });
}
