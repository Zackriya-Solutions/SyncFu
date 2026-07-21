import { test, expect, type Page } from "@playwright/test";

// T5b lifecycle e2e. Drives the REAL Island (islandMorph.ts full-motion loop) via
// the lifecycle harness hooks and asserts the two lifecycle guarantees that a
// settled snapshot cannot show:
//   1. new-notification MID-MORPH is latest-wins and the OS frame never resizes
//      (D3): the envelope box is identical before / mid-flight / after, while the
//      inner capsule morphs; a mid-flight frame (width strictly between compact and
//      expanded) is captured, closing T4b's "settled-frames-only" coverage gap.
//   2. a progress update arriving AFTER collapse refreshes the compact pill live
//      (never stale) and expanding shows the current value (invariant d).
//
// Full motion (the global config runs "reduce", which would snap the morph) so a
// real mid-flight frame exists.
test.use({ reducedMotion: "no-preference" });

const URL = "http://localhost:1420/e2e/harness/island-lifecycle.html";

async function waitReady(page: Page) {
  await page.locator(".di-island").waitFor();
  await page.waitForFunction(
    () => typeof (window as unknown as { __setState?: unknown }).__setState === "function"
  );
}

async function waitSettled(page: Page, width?: string) {
  await page.waitForFunction(
    (w) => {
      const settled =
        (window as unknown as { __islandSettled?: boolean }).__islandSettled === true;
      if (!w) return settled;
      const el = document.querySelector(".di-island") as HTMLElement | null;
      return settled && el?.style.width === w;
    },
    width ?? null
  );
}

function islandWidth(page: Page): Promise<number> {
  return page.evaluate(() =>
    parseFloat((document.querySelector(".di-island") as HTMLElement).style.width)
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await waitReady(page);
});

test("new notification mid-morph is latest-wins and the frame never resizes", async ({
  page,
}) => {
  const root = page.locator('[data-testid="island-root"]');
  await waitSettled(page); // compact, settled
  const rootBefore = await root.boundingBox();
  const compactW = await islandWidth(page);
  expect(compactW).toBeLessThan(300); // compact ~218

  // Start a full-motion morph compact -> expanded.
  await page.evaluate(() =>
    (window as unknown as { __setState: (s: string) => void }).__setState("expanded")
  );

  // Capture a MID-FLIGHT frame: the loop is running and the capsule width is
  // strictly between the compact and expanded targets (proves per-frame animation,
  // not an instant snap). Closes the T4b mid-flight coverage gap.
  await page.waitForFunction(() => {
    const el = document.querySelector(".di-island") as HTMLElement | null;
    const w = el ? parseFloat(el.style.width) : 0;
    return (
      (window as unknown as { __islandSettled?: boolean }).__islandSettled === false &&
      w > 218.5 &&
      w < 379.5
    );
  });
  const rootMid = await root.boundingBox();
  const midW = await islandWidth(page);
  expect(midW).toBeGreaterThan(compactW);
  expect(midW).toBeLessThan(380);

  // A NEW distinct notification arrives mid-morph -> latest-wins re-present (the
  // key remount snaps to the expanded controlled state; the old loop disposes).
  await page.evaluate(() =>
    (window as unknown as { __present: (p: unknown) => void }).__present({
      id: "life-b",
      title: "Production incident",
      body: "Error rate spiked to 12%",
      progress: undefined,
    })
  );
  await waitSettled(page, "380px");

  const rootAfter = await root.boundingBox();
  await expect(page.getByText("Production incident")).toBeVisible();
  // The previous item is gone (re-presented, never a half-morph blend).
  await expect(page.getByText("Building project")).toHaveCount(0);

  // D3: the envelope (OS frame) box is identical throughout - only the inner
  // capsule morphed.
  expect(rootMid).toEqual(rootBefore);
  expect(rootAfter).toEqual(rootBefore);
});

test("a progress update after collapse is live, and expanding shows the current value", async ({
  page,
}) => {
  await waitSettled(page); // compact pill, arrival progress 0.2
  await expect(page.locator(".di-mini-pct")).toHaveText("20%");

  // Progress advances WHILE collapsed -> the pill live-activity refreshes in place.
  await page.evaluate(() =>
    (window as unknown as { __update: (p: unknown) => void }).__update({
      progress: { value: 0.7, style: "bar" },
    })
  );
  await expect(page.locator(".di-mini-pct")).toHaveText("70%");

  // Expanding shows the CURRENT value (70%), never the stale arrival value (20%).
  await page.evaluate(() =>
    (window as unknown as { __setState: (s: string) => void }).__setState("expanded")
  );
  await waitSettled(page, "380px");
  await expect(page.locator(".di-plabel")).toContainText("70%");
  await expect(page.locator(".di-plabel")).not.toContainText("20%");
});
