#!/usr/bin/env bash
# multi-notification-model-b.sh
#
# Fill the Dynamic Island with several notifications at once to demonstrate
# "Model B" - the multi-notification view.
#
# With more than one active island notification the compact pill shows the
# highest-priority SPOTLIGHT item plus an "xN" count badge (capped at "9+").
# Click the spotlight to expand a priority-ranked, deduped list (critical
# first), capped at 6 rows before it scrolls. In the expanded list:
#   - each row has its own action button and a hover-visible x (dismiss just
#     that row -> its --wait waiter, if any, resolves as dismissed, exit 1),
#   - the header "Clear all" empties the island in one click. NOTE: "Clear all"
#     calls dismiss-all, which also clears any top-right CARD notifications and
#     resolves every waiter as dismissed. It is a deliberate global clear.
#
# Requires the syncfu desktop app running (HTTP server on :9868).

set -euo pipefail

send_island() { syncfu send --presentation island "$@" >/dev/null; }

send_island -t "Build failed"   -s ci        -p critical -i triangle-alert "main is red"
send_island -t "PR #128"        -s github     -p high     -i git-pull-request "review requested"
send_island -t "Backup done"    -s cron       -p normal   -i circle-check "nightly backup ok"
send_island -t "New star"       -s github     -p low      -i trophy "repo hit 1k stars"

echo "Sent 4 island notifications. The island now shows the critical spotlight"
echo "plus an x4 badge. Click it to expand the ranked list, then use a per-row x"
echo "or the header 'Clear all'."

# For an unattended demo, clear everything after a beat. Comment this out to
# interact with the list by hand.
sleep 4
syncfu dismiss-all
echo "Cleared."
