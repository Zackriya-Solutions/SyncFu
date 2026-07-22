import { test, expect } from "@playwright/test";

// T13/T14 under-notch acceptance: on a real notched display the island renders as a
// SECOND NOTCH directly below the physical cutout, so ALL of its content (compact
// pill AND expanded card) sits fully BELOW the cutout, never behind it. While collapsed
// and not hovered the pill is concealed and a minimal AMBIENT WINGS indicator shows in
// its place (T14): slim black wings peek beside the cutout with a priority-accent hint in
// the RIGHT wing, and NOTHING sits behind the cutout. The harness overlays a black
// rectangle at the exact cutout position (G1's 183x32) ABOVE the island; this spec reuses
// the wall-audit leaf-measurement technique to assert no content intersects that rectangle.
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
  await page.locator('#cell-ambient [data-testid="island-ambient"]').waitFor();
  await page.locator("#cell-compact .di-compact").waitFor();
  await page.locator("#cell-expanded .di-expanded").waitFor();
});

test("ambient wings peek beside the cutout; the accent dot sits clear in the right wing (T14)", async ({
  page,
}) => {
  const cutout = await cutoutRect(page, "cell-ambient");
  const ambient = await page
    .locator('#cell-ambient [data-testid="island-ambient"]')
    .boundingBox();
  if (!ambient) throw new Error("no ambient box");
  // The wings extend the black shape past the cutout on BOTH sides (slim extensions peek out).
  expect(ambient.x).toBeLessThan(cutout.x);
  expect(ambient.x + ambient.width).toBeGreaterThan(cutout.x + cutout.width);
  // Flush at the top edge (butted against the cutout, reads as one notch band).
  expect(Math.abs(ambient.y - cutout.y)).toBeLessThan(1);

  // The accent dot is the ONLY hint, and it lives fully in the RIGHT wing - clear of the cutout,
  // never behind it (T12 taught us content behind the cutout is invisible).
  const dot = await page
    .locator('#cell-ambient [data-testid="island-ambient-dot"]')
    .boundingBox();
  if (!dot) throw new Error("no ambient dot box");
  expect(intersects(dot, cutout)).toBe(false);
  expect(dot.x).toBeGreaterThanOrEqual(cutout.x + cutout.width - 0.5);
});

test("compact content clears the cutout (whole pill sits below it)", async ({
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

test("the compact pill keeps its full content below the cutout (label restored)", async ({
  page,
}) => {
  // The under-notch pill lays out normally: the sender label is back (no wing
  // omission), and it renders below the cutout (asserted by the clears-cutout test).
  await expect(page.locator("#cell-compact .di-sender")).toHaveCount(1);
  await expect(page.locator("#cell-compact .di-dot")).toBeVisible();
  // The whole island is offset down: the reveal wrapper carries the notch marker.
  await expect(
    page.locator('#cell-compact [data-testid="island-reveal"]')
  ).toHaveAttribute("data-notch", "true");
});
