#!/usr/bin/env bash
#
# T11 end-to-end operator journey (EVIDENCE, not production code).
#
# Composition argument (why this shape):
#   The shipping app hardcodes HTTP port 9868 (src-tauri/src/lib.rs:
#   start_server(server_state, 9868), no env override) and launches real desktop
#   windows. On the T11 machine :9868 is held by the user's installed production
#   instance (/Applications/syncfu.app), which must not be killed, and the port
#   cannot be rebound without a production src/ change (forbidden for T11). So the
#   full Tauri app cannot be spawned here. Per T11's degrade-honestly rule this
#   drives the CLI <-> HTTP <-> manager <-> waiters journey end-to-end with NO
#   webview, against the REAL server stack on an EPHEMERAL port (the example
#   harness src-tauri/examples/journey_server.rs reuses build_router + the real
#   NotificationManager + WaiterRegistry). The UI / morph / click layer is proven
#   separately by the vitest + Playwright harness suites (e2e/island-*.spec.ts);
#   the button-click that this journey simulates with an HTTP action POST is that
#   layer's job. Exit codes, waiter routing (A4), and Model B ranking below all
#   run against production logic.
#
# What each exit code means (cli/src/main.rs): Action=0, Dismissed=1, Timeout=2.
# NOTE: clicking ANY action button (approve OR deny) resolves as Action -> exit 0
# with that action_id. Exit 1 comes only from a dismiss; exit 2 only from timeout.
#
# Run:  bash e2e/journey/run-journey.sh
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/Users/sujith/work/2025/syncfu/target}"

PASS=0
FAIL=0
HARNESS_PID=""
declare -a CLI_PIDS=()
TMP="$(mktemp -d "${TMPDIR:-/tmp}/syncfu-journey.XXXXXX")"

cleanup() {
  for p in "${CLI_PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  [ -n "$HARNESS_PID" ] && kill "$HARNESS_PID" 2>/dev/null
  wait 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
check() { # check <desc> <actual> <expected>
  if [ "$2" = "$3" ]; then pass "$1 (=$2)"; else fail "$1 (got '$2' want '$3')"; fi
}

# Wait up to <sec> for pid to exit; returns its exit code, or 124 on watchdog kill.
wait_pid_timeout() {
  local pid="$1" sec="$2" i
  for ((i=0; i*10 < sec*100; i++)); do
    kill -0 "$pid" 2>/dev/null || { wait "$pid"; return $?; }
    sleep 0.1
  done
  echo "  (watchdog) killing hung pid $pid after ${sec}s" >&2
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124
}

jqget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

echo "== T11 operator journey =="
echo "target dir: $CARGO_TARGET_DIR"

# --- Build the REAL CLI (resolve its path unambiguously; app + cli both build a
#     binary named 'syncfu', so read the artifact path from cargo, never guess). ---
echo "Building syncfu-cli + journey harness..."
CLI_BIN="$(cargo build -p syncfu-cli --message-format=json 2>/dev/null \
  | python3 -c "
import sys, json
for line in sys.stdin:
    try: o = json.loads(line)
    except Exception: continue
    t = o.get('target', {}) or {}
    if (o.get('reason') == 'compiler-artifact' and t.get('name') == 'syncfu'
            and 'bin' in (t.get('kind') or []) and o.get('executable')
            and '/cli/' in (o.get('manifest_path') or '')):
        print(o['executable'])
")"
if [ -z "${CLI_BIN:-}" ] || [ ! -x "$CLI_BIN" ]; then
  echo "FATAL: could not resolve syncfu-cli binary"; exit 3
fi
echo "CLI: $CLI_BIN"
"$CLI_BIN" --help >/dev/null 2>&1 || { echo "FATAL: CLI unusable"; exit 3; }

cargo build -p syncfu --example journey_server >/dev/null 2>&1 \
  || { echo "FATAL: harness build failed"; exit 3; }
HARNESS_BIN="$CARGO_TARGET_DIR/debug/examples/journey_server"

# --- Boot the harness on an ephemeral port; wait for health. ---
"$HARNESS_BIN" >"$TMP/harness.out" 2>"$TMP/harness.err" &
HARNESS_PID=$!
URL=""
for i in $(seq 1 50); do
  URL="$(grep -m1 JOURNEY_SERVER_URL "$TMP/harness.out" 2>/dev/null | cut -d= -f2-)"
  [ -n "$URL" ] && break
  kill -0 "$HARNESS_PID" 2>/dev/null || { echo "FATAL: harness died"; cat "$TMP/harness.err"; exit 3; }
  sleep 0.2
done
[ -n "$URL" ] || { echo "FATAL: no harness URL"; exit 3; }
HEALTH="$(curl -s --max-time 3 "$URL/health" | jqget "['status']")"
check "harness /health status ok" "$HEALTH" "ok"
echo "harness URL: $URL"
export SYNCFU_SERVER="$URL"

# Spawn a --wait island send; echo the created id. Uses --json so stdout line 1
# is {"id": ...}. Every --wait carries a short --wait-timeout AND lives under the
# per-scenario watchdog (wait_pid_timeout), so no orphaned --wait can survive.
LAST_PID=""
spawn_wait() { # spawn_wait <outfile> <presentation> <wait_timeout> <extra args...>
  # Sets $LAST_PID. MUST be called directly (never via $()): backgrounding inside
  # a command substitution reparents the job away from this shell, so a later
  # `wait` on it fails (exit 127). Kept in-shell so the pid stays waitable.
  local out="$1" pres="$2" wto="$3"; shift 3
  "$CLI_BIN" --json send "body" --title "T11" --presentation "$pres" \
    --wait --wait-timeout "$wto" "$@" >"$out" 2>/dev/null &
  LAST_PID=$!
  CLI_PIDS+=("$LAST_PID")
}
read_id() { # read_id <outfile> -> id (waits for line 1)
  local out="$1" i id=""
  for ((i=0;i<50;i++)); do
    id="$(head -n1 "$out" 2>/dev/null | jqget "['id']" 2>/dev/null)" && [ -n "$id" ] && { echo "$id"; return 0; }
    sleep 0.1
  done
  return 1
}

# ============================================================
echo; echo "-- Scenario A: single island --wait exit semantics --"

# A1: approve action -> exit 0
OUT="$TMP/a1.out"; spawn_wait "$OUT" island 15 -a approve:Approve -a deny:Deny:danger; PID="$LAST_PID"
ID="$(read_id "$OUT")" || fail "A1 could not read id"
if [ -n "${ID:-}" ]; then
  HW="$(curl -s --max-time 3 "$URL/island-snapshot" | jqget "['rows'][0]['hasWaiter']")"
  check "A1 waiter registered (hasWaiter)" "$HW" "True"
  curl -s --max-time 3 -X POST "$URL/notify/$ID/action" -H 'content-type: application/json' \
    -d '{"action_id":"approve"}' >/dev/null
  wait_pid_timeout "$PID" 8; check "A1 approve -> exit" "$?" "0"
  ACT="$(tail -n1 "$OUT" | jqget "['action_id']")"; check "A1 resolved action_id" "$ACT" "approve"
fi

# A2: deny action -> exit 0, action_id 'deny' (action-specific routing)
OUT="$TMP/a2.out"; spawn_wait "$OUT" island 15 -a approve:Approve -a deny:Deny:danger; PID="$LAST_PID"
ID="$(read_id "$OUT")" || fail "A2 could not read id"
if [ -n "${ID:-}" ]; then
  curl -s --max-time 3 -X POST "$URL/notify/$ID/action" -H 'content-type: application/json' \
    -d '{"action_id":"deny"}' >/dev/null
  wait_pid_timeout "$PID" 8; check "A2 deny -> exit" "$?" "0"
  ACT="$(tail -n1 "$OUT" | jqget "['action_id']")"; check "A2 resolved action_id" "$ACT" "deny"
fi

# A3: dismiss -> exit 1
OUT="$TMP/a3.out"; spawn_wait "$OUT" island 15 -a approve:Approve; PID="$LAST_PID"
ID="$(read_id "$OUT")" || fail "A3 could not read id"
if [ -n "${ID:-}" ]; then
  curl -s --max-time 3 -X POST "$URL/notify/$ID/dismiss" >/dev/null
  wait_pid_timeout "$PID" 8; check "A3 dismiss -> exit" "$?" "1"
fi

# A4: timeout -> exit 2 (no action; short wait-timeout)
OUT="$TMP/a4.out"; spawn_wait "$OUT" island 2 -a approve:Approve; PID="$LAST_PID"
ID="$(read_id "$OUT")" || fail "A4 could not read id"
wait_pid_timeout "$PID" 8; check "A4 timeout -> exit" "$?" "2"

# ============================================================
echo; echo "-- Scenario B: 3+ concurrent islands, Model B + A4 waiter routing --"
curl -s --max-time 3 -X POST "$URL/dismiss-all" >/dev/null
declare -a BPID=() BID=() BACT=(approve deny ack)
for k in 0 1 2; do
  OUT="$TMP/b$k.out"
  PRIO=(critical high normal)
  spawn_wait "$OUT" island 20 --priority "${PRIO[$k]}" -a "${BACT[$k]}:Do"; BPID[$k]="$LAST_PID"
  BID[$k]="$(read_id "$OUT")" || fail "B$k could not read id"
done
sleep 0.3
SNAP="$(curl -s --max-time 3 "$URL/island-snapshot")"
CNT="$(echo "$SNAP" | jqget "['count']")"; check "B snapshot count" "$CNT" "3"
ROWS="$(echo "$SNAP" | jqget "['rows'].__len__()")"; check "B ranked rows" "$ROWS" "3"
# critical must rank first (spotlight) - Model B priority ordering
SPOT="$(echo "$SNAP" | jqget "['spotlight']['priority']")"; check "B spotlight is critical" "$SPOT" "critical"
# all three waiters present as hasWaiter true
ALLW="$(echo "$SNAP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(all(r['hasWaiter'] for r in d['rows']))")"
check "B all rows hasWaiter" "$ALLW" "True"
# A4 end-to-end: action each id with ITS action; each CLI must resolve with the id's OWN action.
for k in 0 1 2; do
  curl -s --max-time 3 -X POST "$URL/notify/${BID[$k]}/action" -H 'content-type: application/json' \
    -d "{\"action_id\":\"${BACT[$k]}\"}" >/dev/null
  wait_pid_timeout "${BPID[$k]}" 8; RC=$?
  check "B$k exit 0" "$RC" "0"
  RES="$(tail -n1 "$TMP/b$k.out" | jqget "['action_id']")"
  check "B$k right waiter resolved (A4)" "$RES" "${BACT[$k]}"
done

# ============================================================
echo; echo "-- Scenario C: top-right CARD regression --"
OUT="$TMP/c.out"; spawn_wait "$OUT" card 15 -a ok:OK; PID="$LAST_PID"
ID="$(read_id "$OUT")" || fail "C could not read id"
if [ -n "${ID:-}" ]; then
  # A card send must NOT appear in the island Model B snapshot (presentation scoping).
  CSNAP="$(curl -s --max-time 3 "$URL/island-snapshot" | jqget "['count']")"
  check "C card absent from island snapshot" "$CSNAP" "0"
  curl -s --max-time 3 -X POST "$URL/notify/$ID/action" -H 'content-type: application/json' \
    -d '{"action_id":"ok"}' >/dev/null
  wait_pid_timeout "$PID" 8; check "C card approve -> exit" "$?" "0"
fi

# ============================================================
echo; echo "-- Scenario D: settings mid-journey (DEGRADED: IPC-only) --"
echo "  SKIP(manual): live settings push is IPC-only (set_island_settings emits"
echo "  island:settings to the island webview; no HTTP surface, no webview here)."
echo "  Covered by: src-tauri settings.rs unit tests (persist/clamp/atomic) +"
echo "  e2e/island-settings.spec.ts (live restyle in the Playwright harness)."
echo "  See RELEASE-CHECKLIST.md 'Manual / degraded items'."

# ============================================================
echo; echo "-- Capture-exclusion status on THIS machine --"
echo "  macOS major 26 (Tahoe) >= best-effort boundary (15): surfaced status ="
echo "  BEST_EFFORT ('macOS 15 and later can still capture this window'); the"
echo "  hideFromScreenCapture flag is still applied unconditionally (defense in"
echo "  depth). get_island_capture_status is IPC-only; derivation is unit-tested"
echo "  (derive_capture_status). Guaranteed-tier capture checks are manual per OS."

echo; echo "== RESULT: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
