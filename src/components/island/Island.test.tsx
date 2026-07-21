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

  it("wires the expanded surface fill to the shared --s-card-bg override", () => {
    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const path = container.querySelector(".di-shape path");
    // Expanded honors the shared override var (invariant c), unlike compact.
    expect(path?.getAttribute("fill")).toContain("--s-card-bg");
  });

  it("applies the 27 --s-* overrides via the shared styleVars map (invariant c)", () => {
    const style: StyleOverrides = {
      titleColor: "#ff00ff",
      bodyColor: "#00ffff",
      accentColor: "#123456",
    };
    render(<Island notification={makeNotification({ style })} state="expanded" />);
    const expanded = screen.getByTestId("island-expanded");
    // buildStyleVars (shared with the card) sets each override as its --s-* prop.
    expect(expanded.style.getPropertyValue("--s-title-color")).toBe("#ff00ff");
    expect(expanded.style.getPropertyValue("--s-body-color")).toBe("#00ffff");
    expect(expanded.style.getPropertyValue("--s-accent-color")).toBe("#123456");
  });

  it("insets content horizontally by the wall padding (R-WALL)", () => {
    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const content = container.querySelector(".di-content") as HTMLElement;
    // wallPadding(19, "card") = max(16, 19 + 5) = 24 for the expanded shoulder.
    expect(content.style.paddingLeft).toBe("24px");
    expect(content.style.paddingRight).toBe("24px");
  });
});
