import { test, expect } from "@playwright/test";

// Appearance baselines (T8): dark / light / auto expanded cards, the light float
// compact pill, and the notch-compact-stays-black-in-light guard (invariant d).
// Rendered by e2e/harness/island-appearance.tsx from the REAL Island component.
const URL = "http://localhost:1420/e2e/harness/island-appearance.html";

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.locator("#cell-dark-expanded .di-expanded").waitFor();
});

// Visual baselines for the appearances that do not depend on the emulated OS scheme.
for (const id of ["dark-expanded", "light-expanded", "light-float-pill"] as const) {
  test(`appearance ${id}`, async ({ page }) => {
    await expect(page.locator(`#cell-${id} .di-island`)).toHaveScreenshot(
      `appearance-${id}.png`
    );
  });
}

test("light expanded card uses the frosted #f4f4f6 surface + dark ink", async ({ page }) => {
  const island = page.locator("#cell-light-expanded .di-island");
  await expect(island).toHaveClass(/di-light-content/);
  await expect(island.locator(".di-shape path")).toHaveAttribute(
    "fill",
    "rgba(244,244,246,0.94)"
  );
  // Dark ink ramp: the title resolves to the near-black light-mode ink.
  await expect(island.locator(".di-title")).toHaveCSS("color", "rgba(0, 0, 0, 0.9)");
});

test("light float compact pill uses the #e9e9ee surface", async ({ page }) => {
  await expect(page.locator("#cell-light-float-pill .di-shape path")).toHaveAttribute(
    "fill",
    "rgba(233,233,238,0.94)"
  );
});

test("notch compact pill stays pure black even in LIGHT appearance (invariant d)", async ({
  page,
}) => {
  const island = page.locator("#cell-light-notch-compact .di-island");
  await expect(island.locator(".di-shape path")).toHaveAttribute("fill", "#000000");
  // And it does NOT get the dark-ink re-skin (its label stays light on black).
  await expect(island).not.toHaveClass(/di-light-content/);
});

// auto follows prefers-color-scheme: the SAME auto cell renders dark under a dark
// OS and light under a light OS, via the live media-query listener.
test.describe("auto follows the OS scheme", () => {
  test("auto is dark under a dark OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const path = page.locator("#cell-auto-expanded .di-shape path");
    // Dark auto keeps the var(--s-card-bg) dark surface (no light re-skin).
    await expect(path).toHaveAttribute("fill", /var\(--s-card-bg/);
    await expect(page.locator("#cell-auto-expanded .di-island")).not.toHaveClass(
      /di-light-content/
    );
  });

  test("auto flips to light under a light OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const island = page.locator("#cell-auto-expanded .di-island");
    await expect(island.locator(".di-shape path")).toHaveAttribute(
      "fill",
      "rgba(244,244,246,0.94)"
    );
    await expect(island).toHaveClass(/di-light-content/);
    await expect(island).toHaveScreenshot("appearance-auto-expanded-light.png");
  });
});
