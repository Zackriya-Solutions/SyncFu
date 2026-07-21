import { test, expect } from "@playwright/test";

// Float-position baselines (T8): left / center / right anchor the capsule to the
// matching edge; bottom-center anchors to the bottom, mirrors the notch shape
// vertically, and grows UPWARD. Rendered by e2e/harness/island-position.tsx.
const POSITION_URL = "http://localhost:1420/e2e/harness/island-position.html";
const BOTTOMCENTER_URL = "http://localhost:1420/e2e/harness/island-bottomcenter.html";

const POSITIONS = ["left", "center", "right", "bottom-center"] as const;

test.describe("float positions (static)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(POSITION_URL);
    await page.locator("#cell-left .di-expanded").waitFor();
  });

  for (const position of POSITIONS) {
    test(`position ${position}`, async ({ page }) => {
      await expect(page.locator(`#cell-${position}`)).toHaveScreenshot(
        `position-${position}.png`
      );
    });
  }

  test("bottom-center mirrors the notch path; other positions do not", async ({ page }) => {
    // Mirrored: the flipped origin is M 0 <H> (non-zero), concave shoulders on the
    // bottom. The top-notch positions all start at M 0 0.
    await expect(page.locator("#cell-bottom-center .di-shape path")).toHaveAttribute(
      "d",
      /^M 0 [1-9]/
    );
    for (const position of ["left", "center", "right"] as const) {
      await expect(page.locator(`#cell-${position} .di-shape path`)).toHaveAttribute(
        "d",
        /^M 0 0 /
      );
    }
  });

  test("left anchors the capsule to the left edge, right to the right edge", async ({
    page,
  }) => {
    const box = async (position: string) => {
      const b = await page.locator(`#cell-${position} .di-island`).boundingBox();
      const cell = await page.locator(`#cell-${position}`).boundingBox();
      if (!b || !cell) throw new Error(`missing box for ${position}`);
      return { leftGap: b.x - cell.x, rightGap: cell.x + cell.width - (b.x + b.width) };
    };
    const left = await box("left");
    const right = await box("right");
    // Left position hugs the left edge (small left gap, large right gap); right is
    // the mirror image.
    expect(left.leftGap).toBeLessThan(left.rightGap);
    expect(right.rightGap).toBeLessThan(right.leftGap);
  });
});

test.describe("bottom-center grows upward (bottom edge stays put)", () => {
  // Real spring motion (the global config forces reduce, which would snap).
  test.use({ reducedMotion: "no-preference" });

  async function metrics(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const el = document.querySelector(".di-island") as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    });
  }

  test("the bottom edge is fixed while the capsule expands upward mid-morph", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.goto(BOTTOMCENTER_URL);
    await page.locator(".di-island").waitFor();
    await page.waitForFunction(
      () => (window as unknown as { __islandSettled?: boolean }).__islandSettled === true
    );

    const compact = await metrics(page);
    expect(compact).not.toBeNull();

    // Kick the morph to expanded WITHOUT awaiting settle, then sample the box
    // repeatedly during the animation.
    await page.evaluate(() =>
      (window as unknown as { __setIslandState: (s: string) => void }).__setIslandState(
        "expanded"
      )
    );

    const samples: { bottom: number; height: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const m = await metrics(page);
      if (m) samples.push({ bottom: m.bottom, height: m.height });
      await page.waitForTimeout(25);
    }

    await page.waitForFunction(
      () => (window as unknown as { __islandSettled?: boolean }).__islandSettled === true
    );
    const expanded = await metrics(page);
    expect(expanded).not.toBeNull();

    // Grew: the expanded card is taller than the compact pill.
    expect(expanded!.height).toBeGreaterThan(compact!.height + 10);
    // Bottom edge stayed put: compact bottom == expanded bottom (within 1.5px) AND
    // every mid-morph sample shares that bottom (the capsule extended UPWARD, its
    // top moved up while the bottom held).
    expect(Math.abs(expanded!.bottom - compact!.bottom)).toBeLessThanOrEqual(1.5);
    // At least one sample caught the capsule taller than compact but not yet fully
    // expanded, proving we measured DURING the morph, not only at its endpoints.
    const midMorph = samples.filter(
      (s) => s.height > compact!.height + 2 && s.height < expanded!.height - 2
    );
    expect(midMorph.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(Math.abs(s.bottom - compact!.bottom)).toBeLessThanOrEqual(1.5);
    }
    // And the top moved UP as it grew (upward expansion, not downward).
    expect(expanded!.top).toBeLessThan(compact!.top - 5);
  });
});
