import { test, expect } from "@playwright/test";

// Visual baselines for the REAL island React components (T4a), rendered by
// e2e/harness/island-render.tsx from src/components/island/*. A regression in
// the component tree, styleVars wiring, wall inset, or notch shape shifts these
// pixels. Baselines live beside the T2 shape + mockup baselines under the same
// {projectName}-{platform} template (playwright.config.ts).
//
// Served by the same Vite dev server as the T2 harness (port 1420).
const RENDER_URL =
  "http://localhost:1420/e2e/harness/island-render.html";

// Fixture ids mirror island-render.tsx FIXTURES.
const FIXTURES = [
  "compact",
  "expanded-basic",
  "expanded-rich-body",
  "expanded-critical",
  "expanded-styled-27",
  "expanded-actions",
  "expanded-tall",
  "expanded-progress-bar",
  "expanded-progress-ring",
  "compact-progress",
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(RENDER_URL);
  // Let React mount + the layout-effect content measurement settle.
  await page.locator("#cell-expanded-basic .di-expanded").waitFor();
  // Wait for every cell's rAF morph loop to park (springs at rest, snapped to
  // target). Any active controller re-writes the flag false each frame, so
  // true means all islands are at their settled geometry - without this,
  // toHaveScreenshot can capture a mid-settle frame (flaky 1px drift).
  await page.waitForFunction(() => (window as any).__islandSettled === true);
});

for (const id of FIXTURES) {
  test(`island ${id}`, async ({ page }) => {
    await expect(page.locator(`#cell-${id} .di-island`)).toHaveScreenshot(
      `island-${id}.png`
    );
  });
}

// Structural assertions that back the visual baselines (fast-fail on drift).
test("compact renders the pure-black pill anatomy", async ({ page }) => {
  const path = page.locator("#cell-compact .di-shape path");
  await expect(path).toHaveAttribute("fill", "#000000");
  await expect(page.locator("#cell-compact .di-dot")).toBeVisible();
  await expect(page.locator("#cell-compact .di-sender")).toBeVisible();
});

test("styled-27 fixture wires overrides onto the expanded surface", async ({ page }) => {
  const expanded = page.locator("#cell-expanded-styled-27 .di-expanded");
  // The shared --s-* map is published on the .di-island root and inherits down to
  // the content node (invariant c).
  await expect(expanded).toHaveCSS("--s-title-color", "#fdf4ff");
  // The cardBg override must reach the SVG PATH (the surface), not just the
  // content. The path reads var(--s-card-bg), and the override lives on the
  // .di-island ancestor, so the computed fill resolves to the saturated green.
  const path = page.locator("#cell-expanded-styled-27 .di-shape path");
  await expect(path).toHaveCSS("fill", "rgba(16, 185, 129, 0.96)");
});

// T15: the expanded card carries a hover-visible close button that is invisible at
// rest (so every baseline above is unchanged) and reveals on hover. The critical
// fixture is the primary bug case: a no-action critical notification that never
// auto-dismisses must still be closable.
test("expanded card has a close button, hidden at rest and revealed on hover", async ({
  page,
}) => {
  const close = page.locator("#cell-expanded-critical .di-close");
  await expect(close).toHaveCount(1);
  await expect(close).toHaveAttribute("aria-label", "Dismiss");
  // Out of flow + transparent at rest: no baseline impact.
  await expect(close).toHaveCSS("position", "absolute");
  await expect(close).toHaveCSS("opacity", "0");
  // Hovering the island reveals it (opacity -> 1).
  await page.locator("#cell-expanded-critical .di-island").hover();
  await expect(close).toHaveCSS("opacity", "1");
});

// T5a: a decision renders primary/danger buttons and a PAUSED countdown, while a
// timed non-decision (expanded-basic) renders a RUNNING countdown. Both cover the
// "actions + countdown render" acceptance against the real components.
test("decision renders action buttons and a paused countdown", async ({ page }) => {
  const cell = page.locator("#cell-expanded-actions");
  const buttons = cell.locator(".di-actions2 .di-btn2");
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveClass(/accent/); // primary
  await expect(buttons.nth(1)).toHaveClass(/danger/); // danger
  // Countdown present but NOT running (auto-dismiss paused while awaiting answer).
  await expect(cell.locator(".di-countdown-fill")).toBeVisible();
  await expect(cell.locator(".di-countdown-fill.running")).toHaveCount(0);
});

test("timed non-decision renders a running countdown", async ({ page }) => {
  // expanded-basic is normal-priority with the default timeout -> auto-dismisses,
  // so its countdown bar is the running variant.
  await expect(
    page.locator("#cell-expanded-basic .di-countdown-fill.running")
  ).toBeVisible();
});

// T5b progress: the expanded bar fill honors the shared --s-progress-color (here
// the default accent) and the ring is a real SVG dash arc; the compact pill shows
// a trailing mini-ring live-activity.
test("expanded progress bar renders a filled bar with the percent label", async ({ page }) => {
  const cell = page.locator("#cell-expanded-progress-bar");
  await expect(cell.locator(".di-pbar-fill")).toBeVisible();
  await expect(cell.locator(".di-plabel")).toContainText("62%");
  await expect(cell.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "62");
});

test("expanded progress ring renders an SVG dash arc, not a bar", async ({ page }) => {
  const cell = page.locator("#cell-expanded-progress-ring");
  await expect(cell.locator(".di-ring-fill")).toBeVisible();
  await expect(cell.locator(".di-pbar")).toHaveCount(0);
  await expect(cell.locator(".di-ring-pct")).toContainText("75%");
});

test("compact pill renders a trailing live-activity mini-ring", async ({ page }) => {
  const cell = page.locator("#cell-compact-progress");
  await expect(cell.locator(".di-mini-ring")).toBeVisible();
  await expect(cell.locator(".di-mini-pct")).toContainText("40%");
});

// NOTCH-OVERHANG CHECK: the tall card grows downward and is never clipped by our
// own layout (no overflow:hidden), confirming the T3 "no top slack" observation
// is a placement concern, not a T4a content-clipping bug. See island-render.tsx.
test("tall expanded card is not clipped by its own layout", async ({ page }) => {
  const island = page.locator("#cell-expanded-tall .di-island");
  const content = page.locator("#cell-expanded-tall .di-content");
  const islandBox = await island.boundingBox();
  const contentBox = await content.boundingBox();
  expect(islandBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  // The shape box fully contains the content box vertically (content is not cut).
  expect(contentBox!.y).toBeGreaterThanOrEqual(islandBox!.y - 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(
    islandBox!.y + islandBox!.height + 1
  );
  // Stays within the fixed 560px envelope cap (D3).
  expect(islandBox!.height).toBeLessThanOrEqual(560);
});
