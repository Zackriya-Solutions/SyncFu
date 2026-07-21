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
  "expanded-tall",
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto(RENDER_URL);
  // Let React mount + the layout-effect content measurement settle.
  await page.locator("#cell-expanded-basic .di-expanded").waitFor();
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
  // The shared --s-* map resolves on the island node (invariant c).
  await expect(expanded).toHaveCSS("--s-title-color", "#fdf4ff");
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
