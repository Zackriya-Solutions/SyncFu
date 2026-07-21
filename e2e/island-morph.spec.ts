import { test, expect } from "@playwright/test";

// T4b morph-engine e2e. Drives the FULL-MOTION spring morph (islandMorph.ts) via
// the mandated window.__islandSettled hook and asserts the two live-loop
// guarantees the plan calls out:
//   1. determinism - the settled morph is pixel-identical across 20 runs (the
//      eps guard snaps every spring exactly to target, so frame timing can never
//      shift the settled result);
//   2. idle cost 0% - once a morph settles the loop parks itself, so NO further
//      animation frames are scheduled (R-PERF).
//
// reducedMotion is forced OFF here (the global config runs "reduce", which would
// snap the morph); this file exercises the real spring path (guard G7).
test.use({ reducedMotion: "no-preference" });

const MORPH_URL = "http://localhost:1420/e2e/harness/island-morph.html";

/** Flip the controlled state and wait until the spring loop settles at it. */
async function morphTo(page: import("@playwright/test").Page, state: "compact" | "expanded") {
  const width = state === "expanded" ? "380px" : "218px";
  await page.evaluate((s) => {
    (window as unknown as { __setIslandState: (s: string) => void }).__setIslandState(s);
  }, state);
  // Settled == springs at eps-rest AND the box has reached the target width.
  await page.waitForFunction(
    (w) =>
      (window as unknown as { __islandSettled?: boolean }).__islandSettled === true &&
      (document.querySelector(".di-island") as HTMLElement | null)?.style.width === w,
    width
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(MORPH_URL);
  await page.locator(".di-island").waitFor();
});

test("full-motion morph settles to a pixel-identical result across 20 runs", async ({ page }) => {
  // 40 real spring morphs (compact<->expanded), each awaited to settle - well
  // past the 30s default; the point is determinism, not speed.
  test.setTimeout(120_000);
  const island = page.locator(".di-island");

  // Establish the reference: morph compact -> expanded and settle.
  await morphTo(page, "expanded");
  const reference = await island.screenshot();

  // Repeat the real morph 19 more times; every settled frame must be identical.
  for (let i = 0; i < 19; i++) {
    await morphTo(page, "compact");
    await morphTo(page, "expanded");
    const shot = await island.screenshot();
    expect(shot.equals(reference), `settled morph run ${i + 2} diverged`).toBe(true);
  }
});

test("idle-cost probe: no animation frames are scheduled 500ms after a morph settles", async ({
  page,
}) => {
  await morphTo(page, "expanded");
  await morphTo(page, "compact");

  // Frame counter immediately after settle, then again after a 500ms idle window.
  const before = await page.evaluate(
    () => (window as unknown as { __islandFrames?: number }).__islandFrames ?? 0
  );
  await page.waitForTimeout(500);
  const after = await page.evaluate(
    () => (window as unknown as { __islandFrames?: number }).__islandFrames ?? 0
  );

  expect(after).toBe(before); // the loop parked - zero idle frames
  expect(
    await page.evaluate(
      () => (window as unknown as { __islandSettled?: boolean }).__islandSettled
    )
  ).toBe(true);
});
