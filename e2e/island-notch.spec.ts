import { test, expect } from "@playwright/test";

// BUG A acceptance: on a real notched display the compact/expanded island content
// must live in the visible WINGS beside the physical cutout and BELOW it, never
// behind it. The harness overlays a black rectangle at the exact cutout position
// (G1's 183x32); this spec reuses the wall-audit leaf-measurement technique to
// assert NO content leaf inside .di-content intersects that cutout rectangle.
// Defaults to the shared 1420 harness server; overridable so this worktree can be
// served on its own port while another dev session holds 1420 (no port fight).
const PORT = process.env.HARNESS_PORT ?? "1420";
const URL = `http://localhost:${PORT}/e2e/harness/island-notch.html`;

/** A rect intersects another when they overlap on BOTH axes (touching edges do
 *  not count - a 0.5px epsilon absorbs sub-pixel rounding). */
function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  const eps = 0.5;
  return !(
    a.x + a.width <= b.x + eps ||
    a.x >= b.x + b.width - eps ||
    a.y + a.height <= b.y + eps ||
    a.y >= b.y + b.height - eps
  );
}

/** Collect the visible LEAF rects inside .di-content of a cell (elements with no
 *  element children and a non-zero box) - the actual glyph, label, ring, text. */
async function contentLeaves(page: import("@playwright/test").Page, cellId: string) {
  return page.evaluate((id) => {
    const content = document.querySelector(`#${id} .di-content`);
    if (!content) return [];
    const out: { x: number; y: number; width: number; height: number; tag: string }[] = [];
    for (const el of Array.from(content.querySelectorAll("*"))) {
      if (el.childElementCount > 0) continue; // leaves only
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue; // skip zero-boxes
      out.push({ x: r.x, y: r.y, width: r.width, height: r.height, tag: el.tagName });
    }
    return out;
  }, cellId);
}

async function cutoutRect(page: import("@playwright/test").Page, cellId: string) {
  const box = await page.locator(`#${cellId} [data-testid="cutout"]`).boundingBox();
  if (!box) throw new Error(`no cutout box for ${cellId}`);
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.locator("#cell-compact .di-compact").waitFor();
  await page.locator("#cell-expanded .di-expanded").waitFor();
});

test("compact content clears the cutout (glyph + trailing live in the wings)", async ({
  page,
}) => {
  const cutout = await cutoutRect(page, "cell-compact");
  const leaves = await contentLeaves(page, "cell-compact");
  // Sanity: the compact pill DID render leaves (glyph, ring, percent) so the
  // assertion is not vacuous.
  expect(leaves.length).toBeGreaterThan(0);
  for (const leaf of leaves) {
    expect(
      intersects(leaf, cutout),
      `${leaf.tag} at (${leaf.x.toFixed(1)}, ${leaf.y.toFixed(1)}) ${leaf.width.toFixed(
        1
      )}x${leaf.height.toFixed(1)} overlaps the cutout`
    ).toBe(false);
  }
});

test("expanded content starts below the cutout (top row cleared)", async ({ page }) => {
  const cutout = await cutoutRect(page, "cell-expanded");
  const leaves = await contentLeaves(page, "cell-expanded");
  expect(leaves.length).toBeGreaterThan(0);
  for (const leaf of leaves) {
    expect(
      intersects(leaf, cutout),
      `${leaf.tag} at (${leaf.x.toFixed(1)}, ${leaf.y.toFixed(1)}) ${leaf.width.toFixed(
        1
      )}x${leaf.height.toFixed(1)} overlaps the cutout`
    ).toBe(false);
  }
});

test("the compact sender label is omitted in notch mode (no text behind the cutout)", async ({
  page,
}) => {
  // The wing pill drops the sender label; the glyph + trailing ring remain.
  await expect(page.locator("#cell-compact .di-sender")).toHaveCount(0);
  await expect(page.locator("#cell-compact .di-dot")).toBeVisible();
});
