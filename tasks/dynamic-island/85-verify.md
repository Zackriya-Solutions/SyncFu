# Wave V - Adversarial Verification (assembled by orchestrator from 6 refuter verdicts)

Six load-bearing assumptions attacked; verifiers instructed to default to REFUTED. Verdicts below;
full reasoning in the workflow journal. Every verdict cites repo code, crate source, or primary
external documentation.

## A1 - capture exclusion on the NSPanel: REFUTED-PARTIAL (high confidence)

- Mechanism confirmed: `set_content_protected(true)` -> tao `set_content_protection` ->
  `NSWindow.setSharingType(.none)` (tao-0.35.2 macos/window.rs:1529-1537).
- SURVIVES: the tauri-nspanel conversion preserves the flag (object_setClass isa-swizzle; sharingType
  is an instance ivar). Works on macOS 14 and earlier.
- REFUTED for macOS 15: ScreenCaptureKit IGNORES sharingType/contentProtection on macOS 15+
  (tauri-apps/tauri issue #14200, status:upstream, no known workaround) and Apple DTS states
  (forums thread 792152, re 15.4+): "no public APIs for preventing screen capture."
- CONSEQUENCE (binding on the plan):
  - G2 acceptance = LIVE capture probe under a ScreenCaptureKit recorder on macOS 15, never a
    property read-back (read-back passes while SCK still captures = the exact silent privacy leak).
  - There is NO public-API Plan C on macOS 15. The capture-invisibility differentiator must be
    scoped honestly: guaranteed on macOS <= 14 and Windows (WDA_EXCLUDEFROMCAPTURE); on macOS 15+
    it is best-effort + documented limitation, optionally supplemented by the auto-hide-while-
    capture-app-frontmost fallback. The hideFromScreenCapture toggle must surface true OS-level
    status, never claim protection it cannot deliver.
  - PRD OQ-4 records: Apple guidance is "file Feedback Assistant"; unresolved platform limitation.

## A2 - notch geometry via objc2-app-kit: SURVIVES (high confidence)

- Repo Cargo.lock already resolves objc2-app-kit 0.3.2 (transitive via tauri-nspanel).
- Generated public bindings expose NSScreen::safeAreaInsets / auxiliaryTopLeftArea /
  auxiliaryTopRightArea (macOS 12+ public AppKit; in the crate default feature set). No plugin, no
  NSWindow handle, no private API, no notarization impact.
- Tightenings for G1's task note: add objc2-app-kit as a DIRECT dep at "0.3"; call on main thread
  (MainThreadMarker / run_on_main_thread); validate non-notch nullability semantics (objc2
  non-optional NSRect vs Swift NSRect?) on a non-notch machine.

## A3 - Model B frontend-view claim (C1 crux): REFUTED-PARTIAL (high confidence)

- The frontend store is NOT a mirror: it independently re-implements queueing (own MAX_VISIBLE=5,
  own dedupe, own promotion) over delta events. Four divergence windows, two deterministic:
  W1 re-sent id duplicates in manager.queued but dedupes in store (manager.rs:41-49 vs
  notificationStore.ts:30-33) -> xN badge diverges. W2 dismiss-promotion happens independently on
  both sides (manager.rs:60-65; only notification:dismiss emitted). W3 no reconciliation
  (get_active_notifications never called) -> permanent undercount after reload/late-listener.
  W4 replacement ordering differs (IndexMap append vs store prepend) -> spotlight diverges.
- RESOLUTION (binding): C1 resolves in favor of guard G10 LETTER. Rank/dedupe/cap/count live in
  NotificationManager; manager emits a full authoritative island snapshot on every change; frontend
  IslandList is a dumb renderer. The store's independent queue logic is not extended to the island.

## A4 - --wait identity through Model B dedupe: REFUTED-PARTIAL (high confidence)

- Failure constructed: two --wait notifications sharing dedupe key (same sender::title, no group)
  merge into one row carrying ONE representative id; WaiterRegistry keys strictly by id
  (waiters.rs:39-56); action resolves W1 only; W2 times out -> exit 2 (should be 0).
- Plan self-contradiction confirmed: 02 "row maps to a notification id" vs 04 R-WAIT-ID "never
  collapse two ids into one event" - unreconciled; T6 lists the mapping as a known unknown.
- RESOLUTION (recommended to synthesis): option (a) - notifications with pending waiters are
  EXCLUDED from dedupe merging; each keeps its own row and 1:1 id->waiter mapping. (Fan-out
  option (b) is semantically fragile with heterogeneous action sets.) Acceptance test must
  exercise the two-waiters-same-key collision explicitly.

## A5 - T4/T5/T7 one-PR sizing: REFUTED (high confidence)

- Each bundles 5+ concerns; Wave A independently flagged all three. C7 fix GROWS T4 (App.tsx label
  branch + new IslandOverlay.tsx host + per-window event subscription + NotificationOverlay
  exclusion filter - none in T4's current file list).
- RESOLUTION (binding): split before hand-off:
  - T4a static compact/expanded render + IslandOverlay host + App.tsx routing (C7 fix) + 27-override
    plumbing; T4b morph spring engine + notch-black rule.
  - T5a actions / --wait / timeouts / countdown parity; T5b progress bar+ring + lifecycle
    interruption state machine.
  - T7a Rust settings model + persistence + IPC + TS types; T7b settings UI + live-push restyle.

## A6 - spring rest without epsilon guard: REFUTED-PARTIAL (medium confidence)

- Operational conclusion SURVIVES: the mockup loop does rest (frame() never calls measure();
  measure() is one-shot; RO cannot self-trigger; offsetHeight is integer).
- Justification REFUTED: it rests BECAUSE of the existing eps=0.02 resting guard (mockup 782/786),
  not "without an epsilon guard."
- CONSEQUENCE: port must retain the eps guard AND add R-PERF's rounding guard on measure()
  retargets and R-RAF-DISPOSE's dispose() cancelling pending rAF; never wire measure() into the
  per-frame loop or an unrounded window-resize feedback path (the Tauri webview drives setSize).

## Net effect on the plan

1. Capture-exclusion story rescoped (A1): honest per-OS matrix; live-probe gate; no false safety.
2. G1 spike de-risked to near-certain (A2) with three concrete task-note tightenings.
3. C1 resolved: G10 letter; manager-owned Model B snapshot (A3).
4. New PRD decision: waiter-bearing notifications exempt from dedupe (A4).
5. Task count 13 -> 16 via three a/b splits; T4 file list corrected for C7 (A5).
6. Spring port carries eps + rounding + dispose guards as invariants (A6).

## Cross-references for other lanes

- [to:90-synthesis] All six consequences above are BINDING inputs; resolve C1-C7 with them.
- [to:FINAL] Open question for the user: accept the honest macOS 15 capture limitation scoping
  (guaranteed <= 14 + Windows; best-effort + optional auto-hide fallback on 15+)? This changes a
  marketed differentiator and needs a human product call.
