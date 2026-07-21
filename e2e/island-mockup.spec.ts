import { test, expect } from "@playwright/test";

// Pixel targets for every island state the mockup gallery renders as a static
// SVG-notch shot (mountStatic). The interactive playground island and the
// render self-check banner are intentionally NOT snapshotted: the former is
// driven by setInterval, the latter is position:fixed outside these locators.

const MOCKUP = "/tasks/dynamic-island-mockup.html";

// The 11 #shot-<id> cells from section 04 (STATES array in the mockup).
const STATE_IDS = [
  "compact-idle",
  "compact-timer",
  "compact-ring",
  "compact-count",
  "expanded-basic",
  "expanded-actions",
  "expanded-decision",
  "expanded-progress",
  "expanded-ring",
  "expanded-critical",
  "expanded-markdown",
] as const;

// Section 05 cross-platform trio: notch (mac) vs floating capsule (win/linux).
const PLATFORMS = ["mac", "win", "linux"] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(MOCKUP);
});

for (const id of STATE_IDS) {
  test(`state ${id}`, async ({ page }) => {
    await expect(page.locator(`#shot-${id}`)).toHaveScreenshot(`shot-${id}.png`);
  });
}

for (const plat of PLATFORMS) {
  test(`platform ${plat}`, async ({ page }) => {
    await expect(page.locator(`[data-plat="${plat}"]`)).toHaveScreenshot(
      `plat-${plat}.png`
    );
  });
}

// Section 06 theme gallery: the seven --s-* customization cells.
test("theme gallery cells", async ({ page }) => {
  const cells = page.locator("#themeGrid .theme-cell");
  const count = await cells.count();
  expect(count).toBe(7);
  for (let i = 0; i < count; i++) {
    await expect(cells.nth(i)).toHaveScreenshot(`theme-${i}.png`);
  }
});
