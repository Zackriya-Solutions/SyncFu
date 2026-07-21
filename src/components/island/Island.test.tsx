import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Island } from "./Island";
import type { NotificationPayload, StyleOverrides } from "@/types/notification";

function makeNotification(
  overrides: Partial<NotificationPayload> = {}
): NotificationPayload {
  return {
    id: "isl-1",
    sender: "claude-code",
    title: "Approval needed",
    body: "Run migration 0042 before deploy?",
    priority: "normal",
    presentation: "island",
    timeout: "default",
    actions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Island", () => {
  it("renders the compact pill anatomy: glyph, label, trailing slot", () => {
    render(<Island notification={makeNotification()} state="compact" />);

    // Invariant: compact shows a leading glyph + sender label + trailing slot.
    expect(screen.getByTestId("island-compact")).toBeInTheDocument();
    expect(screen.getByTestId("island-compact-glyph")).toBeInTheDocument();
    expect(screen.getByTestId("island-compact-trailing")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();

    // Compact does NOT render the expanded card.
    expect(screen.queryByTestId("island-expanded")).not.toBeInTheDocument();
  });

  it("renders the expanded card anatomy: sender, title, body", () => {
    render(<Island notification={makeNotification()} state="expanded" />);

    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("Approval needed")).toBeInTheDocument();
    expect(screen.getByText("Run migration 0042 before deploy?")).toBeInTheDocument();

    // Expanded does NOT render the compact pill.
    expect(screen.queryByTestId("island-compact")).not.toBeInTheDocument();
  });

  it("renders the notch shape as an inline SVG path behind the content", () => {
    const { container } = render(
      <Island notification={makeNotification()} state="compact" />
    );
    const path = container.querySelector(".di-shape path");
    expect(path).toBeInTheDocument();
    // Path `d` starts at the origin (M 0 0) - the notchPath contract.
    expect(path?.getAttribute("d")).toMatch(/^M 0 0/);
  });

  it("keeps the compact pill pure black regardless of style overrides (invariant d)", () => {
    // Even with a custom cardBg, the compact notch pill stays pure black: it
    // hugs the physical notch and must not read appearance/surface overrides.
    const style: StyleOverrides = { cardBg: "rgba(255,0,0,0.9)" };
    const { container } = render(
      <Island notification={makeNotification({ style })} state="compact" />
    );
    const path = container.querySelector(".di-shape path");
    expect(path?.getAttribute("fill")).toBe("#000000");
  });

  it("wires the expanded surface fill to the shared --s-card-bg override reaching the path", () => {
    // The path reads `var(--s-card-bg, ...)` and the override is published on the
    // `.di-island` root, the path's ancestor, so the cardBg override reaches it
    // (invariant c). We assert the structural wiring here: the path references the
    // var AND the ancestor carries the override value. The actual COMPUTED pixel
    // fill under an override is asserted in the Playwright styled-27 baseline
    // (island-render.spec.ts), because jsdom does not resolve `var()` inside the
    // SVG `fill` attribute.
    const style: StyleOverrides = { cardBg: "rgba(16,185,129,0.96)" };
    const { container } = render(
      <Island notification={makeNotification({ style })} state="expanded" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;
    const path = container.querySelector(".di-shape path");
    expect(path?.getAttribute("fill")).toContain("--s-card-bg");
    // The override lands on the common ancestor, so it is in scope for the path.
    expect(island.style.getPropertyValue("--s-card-bg")).toBe("rgba(16,185,129,0.96)");
  });

  it("applies the 27 --s-* overrides via the shared styleVars map on the island root (invariant c)", () => {
    const style: StyleOverrides = {
      titleColor: "#ff00ff",
      bodyColor: "#00ffff",
      accentColor: "#123456",
    };
    const { container } = render(
      <Island notification={makeNotification({ style })} state="expanded" />
    );
    // buildStyleVars (shared with the card) sets each override as its --s-* prop on
    // the `.di-island` root, from where it cascades to both the path and content.
    const island = container.querySelector(".di-island") as HTMLElement;
    expect(island.style.getPropertyValue("--s-title-color")).toBe("#ff00ff");
    expect(island.style.getPropertyValue("--s-body-color")).toBe("#00ffff");
    expect(island.style.getPropertyValue("--s-accent-color")).toBe("#123456");
  });

  // --- Appearance (dark/light/auto) + position (T8) ---

  it("keeps the notch compact pill pure black in LIGHT appearance (invariant d)", () => {
    // The whole point of T8's guard: light appearance must NOT lighten the notch
    // compact pill - it hugs the physical black notch in every appearance.
    const { container } = render(
      <Island
        notification={makeNotification()}
        state="compact"
        appearance="light"
        mode="notch"
      />
    );
    const path = container.querySelector(".di-shape path");
    expect(path?.getAttribute("fill")).toBe("#000000");
    // No light-content re-skin on the black notch pill.
    expect(container.querySelector(".di-island")?.classList.contains("di-light-content")).toBe(
      false
    );
  });

  it("lightens the EXPANDED card surface + text in light appearance", () => {
    const { container } = render(
      <Island notification={makeNotification()} state="expanded" appearance="light" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;
    const path = container.querySelector(".di-shape path");
    // Frosted light card fill (#f4f4f6 @ 0.94), not the dark var(--s-card-bg).
    expect(path?.getAttribute("fill")).toBe(
      "rgba(244,244,246, var(--di-surface-opacity, 0.94))"
    );
    // Dark ink ramp is applied via the light-content class.
    expect(island.classList.contains("di-light-content")).toBe(true);
  });

  it("lightens the FLOAT compact pill in light appearance (not the notch pill)", () => {
    const { container } = render(
      <Island
        notification={makeNotification()}
        state="compact"
        appearance="light"
        mode="float"
      />
    );
    const path = container.querySelector(".di-shape path");
    // Light float pill fill (#e9e9ee @ 0.94).
    expect(path?.getAttribute("fill")).toBe(
      "rgba(233,233,238, var(--di-surface-opacity, 0.94))"
    );
    expect(container.querySelector(".di-island")?.classList.contains("di-light-content")).toBe(
      true
    );
  });

  it("keeps the dark expanded surface (no light-content) by default", () => {
    const { container } = render(
      <Island notification={makeNotification()} state="expanded" appearance="dark" />
    );
    const path = container.querySelector(".di-shape path");
    expect(path?.getAttribute("fill")).toContain("--s-card-bg");
    expect(container.querySelector(".di-island")?.classList.contains("di-light-content")).toBe(
      false
    );
  });

  it("mirrors the notch path vertically for flush bottom-center (float)", () => {
    // Bottom-center flips the notch so the concave shoulders sit on the BOTTOM:
    // a compact 218x34 pill starts at M 0 34 (the flipped origin), not M 0 0.
    const { container } = render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="float"
        position="bottom-center"
      />
    );
    const path = container.querySelector(".di-shape path");
    expect(path?.getAttribute("d")).toMatch(/^M 0 34/);
  });

  it("does NOT mirror the path for non-bottom-center positions", () => {
    const { container } = render(
      <Island
        notification={makeNotification()}
        state="compact"
        mode="float"
        position="left"
      />
    );
    const path = container.querySelector(".di-shape path");
    expect(path?.getAttribute("d")).toMatch(/^M 0 0/);
  });

  it("publishes the expanded shoulder inset as --di-wall for the R-WALL padding", () => {
    // Content padding now derives from the morph-driven `--di-wall` in CSS
    // (max(16px, calc(var(--di-wall) + 5px)) = 24px for the expanded shoulder),
    // so the inset tracks every morph frame with no per-frame JS. jsdom cannot
    // compute calc(); we assert the published inset here and leave the resolved
    // pixel padding to the Playwright baseline (island-render.spec.ts).
    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const island = container.querySelector(".di-island") as HTMLElement;
    // Expanded top-shoulder radius is 19 (RADII.expandedTop), snapped on arrival.
    expect(island.style.getPropertyValue("--di-wall")).toBe("19.0px");
  });
});
