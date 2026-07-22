import { test, expect } from "@playwright/test";

// Visual + structural baselines for Model B (T6), rendered by
// e2e/harness/island-group.tsx from the REAL IslandGroup. These are DELIBERATE
// NEW baselines: the compact-grouped spotlight + xN badge widths (2 / "9+"), and
// the expanded ranked list (6-row cap + scroll + bottom fade + row stagger),
// matched against the mockup's Model B grouped stage.
const GROUP_URL = "http://localhost:1420/e2e/harness/island-group.html";

async function settle(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => (window as any).__islandSettled === true);
}

test.beforeEach(async ({ page }) => {
  await page.goto(GROUP_URL);
  await page.locator("#cell-compact-2 .di-spot").waitFor();
  await settle(page);
});

// Compact spotlight badge-width baselines.
for (const id of ["compact-2", "compact-10", "compact-100"] as const) {
  test(`island group ${id}`, async ({ page }) => {
    await expect(page.locator(`#cell-${id} .di-island`)).toHaveScreenshot(
      `island-group-${id}.png`
    );
  });
}

// Badge width is Rust-owned (26 + 8*(digits-1), caps "9+"): assert the exact px.
test("badge width: 2 -> 26px, 10/100 -> '9+' 34px", async ({ page }) => {
  await expect(page.locator("#cell-compact-2 .di-badge-count")).toHaveText("2");
  await expect(page.locator("#cell-compact-2 .di-badge-count")).toHaveCSS(
    "width",
    "26px"
  );
  await expect(page.locator("#cell-compact-10 .di-badge-count")).toHaveText("9+");
  await expect(page.locator("#cell-compact-10 .di-badge-count")).toHaveCSS(
    "width",
    "34px"
  );
  await expect(page.locator("#cell-compact-100 .di-badge-count")).toHaveText("9+");
  await expect(page.locator("#cell-compact-100 .di-badge-count")).toHaveCSS(
    "width",
    "34px"
  );
});

// Expanded ranked list: 6-row cap + scroll + bottom fade.
test("island group expanded list", async ({ page }) => {
  await page.locator("#cell-list .di-spot").click();
  await settle(page);
  await expect(page.locator("#cell-list .di-list")).toBeVisible();
  await expect(page.locator("#cell-list .di-island")).toHaveScreenshot(
    "island-group-list.png"
  );
});

test("expanded list caps at 6 rows / 560px and scrolls past with a bottom fade", async ({
  page,
}) => {
  await page.locator("#cell-list .di-spot").click();
  await settle(page);

  const body = page.locator("#cell-list .di-list-body");
  // 8 rows -> scroll affordance is on (bottom fade mask).
  await expect(body).toHaveAttribute("data-scrolls", "true");

  // The scroll viewport is capped well under the 560px island ceiling and is
  // shorter than its scroll content (proving the 6-row cap, not the morph cap).
  const { clientH, scrollH } = await body.evaluate((el) => ({
    clientH: (el as HTMLElement).clientHeight,
    scrollH: (el as HTMLElement).scrollHeight,
  }));
  expect(clientH).toBeLessThanOrEqual(560);
  expect(scrollH).toBeGreaterThan(clientH);

  // All 8 rows exist in the DOM (the cap is visual, the list is complete).
  await expect(page.locator("#cell-list .di-lrow")).toHaveCount(8);
});

test("rows stagger in at 50ms steps (D5 40-60ms)", async ({ page }) => {
  await page.locator("#cell-list .di-spot").click();
  await settle(page);
  const rows = page.locator("#cell-list .di-lrow");
  await expect(rows.nth(0)).toHaveCSS("animation-delay", "0s");
  await expect(rows.nth(1)).toHaveCSS("animation-delay", "0.05s");
  await expect(rows.nth(2)).toHaveCSS("animation-delay", "0.1s");
});

// Guard G11: Models A (cycle arrows) and C (stack-under) must be absent.
test("Models A and C are absent (guard G11)", async ({ page }) => {
  await page.locator("#cell-list .di-spot").click();
  await settle(page);
  await expect(page.locator('[data-act="prev"]')).toHaveCount(0);
  await expect(page.locator('[data-act="next"]')).toHaveCount(0);
  await expect(page.locator(".stack-host")).toHaveCount(0);
});

// T15 dismissal affordances: the list header carries a persistent "Clear all"
// beside the count, and every row carries a secondary per-row close (hidden at
// rest, revealed on row hover) alongside its primary action button.
test("expanded list has a Clear all control and per-row close affordances", async ({
  page,
}) => {
  await page.locator("#cell-list .di-spot").click();
  await settle(page);

  // Header: Clear all sits beside the count, action buttons stay primary.
  const clear = page.locator("#cell-list .di-list-clear");
  await expect(clear).toHaveCount(1);
  await expect(clear).toHaveText("Clear all");

  // Every row has a secondary close (x): invisible at rest so the list baseline is
  // unchanged, and it does not displace the primary action button in flow.
  const rowCloses = page.locator("#cell-list .di-lrow-close");
  await expect(rowCloses).toHaveCount(8);
  await expect(rowCloses.first()).toHaveCSS("position", "absolute");
  await expect(rowCloses.first()).toHaveCSS("opacity", "0");

  // Hovering a row reveals its close.
  await page.locator("#cell-list .di-lrow").first().hover();
  await expect(rowCloses.first()).toHaveCSS("opacity", "1");
});
