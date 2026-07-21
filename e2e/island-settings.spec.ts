import { test, expect } from "@playwright/test";

// T7b settings acceptance: the panel renders; a width/radius change through a
// panel control re-renders the LIVE island and the content-vs-shape wall
// invariant still holds; capture-status states render honestly. The global
// config forces reducedMotion:"reduce", so a settings change snaps to its new
// geometry - deterministic, no spring settle to await.
const URL = "http://localhost:1420/e2e/harness/island-settings.html";

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await page.locator("#panel-host .island-settings").waitFor();
  await page.locator("#island-host .di-island").waitFor();
});

test("the panel renders the mockup control groups", async ({ page }) => {
  await expect(page.getByTestId("island-settings-panel")).toBeVisible();
  await expect(page.getByTestId("island-set-compactWidth")).toBeVisible();
  await expect(page.getByTestId("island-set-surfaceOpacity")).toBeVisible();
  await expect(page.getByTestId("island-preset-slim")).toBeVisible();
  await expect(page.getByTestId("island-reset")).toBeVisible();
});

test("a width change through the panel re-renders the live island", async ({ page }) => {
  const island = page.locator("#island-host .di-island");
  const before = await island.evaluate((el) => (el as HTMLElement).style.width);
  expect(before).toBe("380px"); // default expanded width

  // Big status preset -> expanded width 520.
  await page.getByTestId("island-preset-big").click();

  await expect
    .poll(() => island.evaluate((el) => (el as HTMLElement).style.width))
    .toBe("520px");
});

test("a radius change through the panel re-renders the island shape", async ({ page }) => {
  const island = page.locator("#island-host .di-island");
  // Expanded top shoulder is 19 with corner-scaling on (the default).
  await expect
    .poll(() => island.evaluate((el) => el.style.getPropertyValue("--di-wall")))
    .toBe("19.0px");

  // Slim bar preset turns corner-scaling OFF (expanded keeps the compact top
  // radius of 4), so the published wall inset drops to 4.
  await page.getByTestId("island-preset-slim").click();

  await expect
    .poll(() => island.evaluate((el) => el.style.getPropertyValue("--di-wall")))
    .toBe("4.0px");
});

test("content stays within the shape after a width/radius change (wall invariant)", async ({
  page,
}) => {
  await page.getByTestId("island-preset-big").click();
  await expect
    .poll(() =>
      page
        .locator("#island-host .di-island")
        .evaluate((el) => (el as HTMLElement).style.width)
    )
    .toBe("520px");

  const islandBox = await page.locator("#island-host .di-island").boundingBox();
  // The inner card (.di-expanded) lives inside the wall padding, so its box must
  // be inset from BOTH shape walls - text/icons never cross the concave shoulder.
  const cardBox = await page.locator("#island-host .di-expanded").boundingBox();
  expect(islandBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(cardBox!.x).toBeGreaterThan(islandBox!.x);
  expect(cardBox!.x + cardBox!.width).toBeLessThan(islandBox!.x + islandBox!.width);
});

test("capture-status states render honestly (green ON only when guaranteed)", async ({
  page,
}) => {
  const status = page.getByTestId("island-capture-status");

  await page.evaluate(() =>
    (window as unknown as {
      __setIslandCaptureStatus: (s: unknown) => void;
    }).__setIslandCaptureStatus({
      status: "on",
      reason: "Hidden from screen capture on this macOS version.",
      enabled: true,
    })
  );
  await expect(status).toHaveAttribute("data-status", "on");
  await expect(status).toContainText("Hidden from screen sharing");
  await expect(status).toHaveClass(/\bon\b/);

  await page.evaluate(() =>
    (window as unknown as {
      __setIslandCaptureStatus: (s: unknown) => void;
    }).__setIslandCaptureStatus({
      status: "best-effort",
      reason: "Best effort only: macOS 15 and later can still capture this window.",
      enabled: true,
    })
  );
  await expect(status).toHaveAttribute("data-status", "best-effort");
  await expect(status).toContainText("Best effort on this OS");
  await expect(status).not.toHaveClass(/\bon\b/);
});
