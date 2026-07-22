import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { Island } from "./Island";
import type { Action, NotificationPayload } from "@/types/notification";

// T5a functional-parity behavior: action invocation, the --wait stays-expanded
// rule, priority auto-dismiss (exit-1 path), critical-never-dismiss, and the
// countdown. The action/dismiss transport (action_callback / dismiss_notification
// -> WaiterRegistry -> CLI exit codes) is UNCHANGED and covered by the Rust/CLI
// integration tests; here we assert the island joins that path with the right
// arguments and lifecycle. rAF is stubbed inert so only the setTimeout-driven
// lifecycle advances (mirrors IslandMorph.test.tsx).

const APPROVE: Action = { id: "approve", label: "Approve", style: "primary" };
const DENY: Action = { id: "deny", label: "Deny", style: "danger" };

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

function stubReducedMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  }));
}

/** Inert rAF so the morph loop never runs; the lifecycle is setTimeout-driven. */
function setup() {
  stubReducedMotion(false);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.useFakeTimers();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Island actions / --wait / timeouts / countdown (T5a)", () => {
  it("drives the card action path: a button click calls onAction(id, actionId)", () => {
    setup();
    const onAction = vi.fn();
    render(
      <Island
        notification={makeNotification({ actions: [APPROVE, DENY] })}
        onAction={onAction}
      />
    );
    // Arrives expanded, so the action buttons are reachable immediately.
    fireEvent.click(screen.getByText("Approve"));
    expect(onAction).toHaveBeenCalledTimes(1);
    // The SAME (notificationId, actionId) the host forwards to action_callback.
    expect(onAction).toHaveBeenCalledWith("isl-1", "approve");
  });

  it("a --wait decision STAYS expanded and never auto-dismisses (invariant b)", () => {
    setup();
    const onDismiss = vi.fn();
    render(
      <Island
        notification={makeNotification({ actions: [APPROVE, DENY] })}
        onDismiss={onDismiss}
      />
    );
    // Far past both the entry-hold collapse and any priority timeout.
    act(() => vi.advanceTimersByTime(60000));
    // Suppressed T4b auto-collapse: still the expanded decision, not a pill.
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
    expect(screen.getByTestId("island")).toHaveAttribute("data-state", "expanded");
    // Auto-dismiss paused while awaiting an answer: exit-1 path NOT taken.
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("a non-decision auto-dismisses at the priority timeout (exit-1 path)", () => {
    setup();
    const onDismiss = vi.fn();
    render(
      <Island notification={makeNotification({ priority: "normal" })} onDismiss={onDismiss} />
    );
    // Before the 8s normal timeout: not yet dismissed.
    act(() => vi.advanceTimersByTime(7999));
    expect(onDismiss).not.toHaveBeenCalled();
    // At 8s: resolves the waiter as Dismissed via the host's dismiss invoke.
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledWith("isl-1");
  });

  it("critical NEVER auto-dismisses (parity with the card)", () => {
    setup();
    const onDismiss = vi.fn();
    render(
      <Island notification={makeNotification({ priority: "critical" })} onDismiss={onDismiss} />
    );
    act(() => vi.advanceTimersByTime(60000));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("renders a RUNNING countdown for a non-decision, reflecting the timeout", () => {
    setup();
    const { container } = render(
      <Island notification={makeNotification()} state="expanded" />
    );
    const fill = container.querySelector(".di-countdown-fill");
    expect(fill).toBeInTheDocument();
    // 8s normal timeout drives the CSS animation duration.
    expect((fill as HTMLElement).style.getPropertyValue("--countdown-duration")).toBe("8000ms");
    expect(fill?.classList.contains("running")).toBe(true);
  });

  it("renders a PAUSED countdown for a decision (auto-dismiss paused)", () => {
    setup();
    const { container } = render(
      <Island
        notification={makeNotification({ actions: [APPROVE, DENY] })}
        state="expanded"
      />
    );
    expect(screen.getByTestId("island-actions")).toBeInTheDocument();
    const fill = container.querySelector(".di-countdown-fill");
    expect(fill).toBeInTheDocument();
    // Present but paused: the bar is a static affordance, not a running timer.
    expect(fill?.classList.contains("running")).toBe(false);
  });

  it("renders NO countdown for critical (never auto-dismisses)", () => {
    setup();
    const { container } = render(
      <Island notification={makeNotification({ priority: "critical" })} state="expanded" />
    );
    expect(container.querySelector(".di-countdown")).not.toBeInTheDocument();
  });

  it("CRITICAL no-action is dismissable via the hover close button (the T15 bug fix)", () => {
    setup();
    const onDismiss = vi.fn();
    render(
      <Island
        notification={makeNotification({ priority: "critical" })}
        onDismiss={onDismiss}
      />
    );
    // Critical arrives expanded, never auto-dismisses, and carries no action
    // buttons - previously stuck with no UI dismissal path. The close resolves it
    // via the SAME exit-1 dismiss_notification path a normal timeout would use.
    fireEvent.click(screen.getByTestId("island-close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("isl-1");
  });

  it("the close click DISMISSES without toggling the surface to compact", () => {
    setup();
    const onDismiss = vi.fn();
    render(
      <Island
        notification={makeNotification({ priority: "critical" })}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByTestId("island-close"));
    // stopPropagation + the interactive-element guard keep click-to-collapse from
    // firing: still the expanded card, never flipped to the compact pill.
    expect(onDismiss).toHaveBeenCalledWith("isl-1");
    expect(screen.getByTestId("island")).toHaveAttribute("data-state", "expanded");
    expect(screen.getByTestId("island-expanded")).toBeInTheDocument();
  });

  it("maps action styles to the mockup di-btn2 variants (primary=accent, danger)", () => {
    setup();
    const { container } = render(
      <Island
        notification={makeNotification({ actions: [APPROVE, DENY] })}
        state="expanded"
      />
    );
    const buttons = container.querySelectorAll(".di-actions2 .di-btn2");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].className).toContain("accent"); // primary
    expect(buttons[1].className).toContain("danger"); // danger
  });
});
