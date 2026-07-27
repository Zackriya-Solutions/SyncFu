#!/usr/bin/env bash
# long-task-progress.sh
#
# Show ambient, glanceable progress for a long-running task on the Dynamic
# Island. One notification is created, then updated in place as the task
# advances - the island never stacks a new notification per step.
#
# On the notch this is the ideal ambient signal: while collapsed and idle the
# island shows the AMBIENT WINGS beside the physical cutout, and because this
# notification carries progress the right wing renders a mini progress ring
# instead of a plain dot. The human hovers the notch to reveal the pill, or
# clicks it to expand the full card with the progress bar.
#
# Use `--timeout never` so an ambient status pill is not auto-dismissed
# mid-task; dismiss it yourself when the work is done.
#
# Requires the syncfu desktop app running (HTTP server on :9868).

set -euo pipefail

# Create the notification and capture its id (JSON output + jq).
ID=$(syncfu send \
  --presentation island \
  -t "Migrating database" \
  -s migrate \
  -i loader \
  --timeout never \
  --progress 0.0 --progress-label "starting" \
  --json \
  "Applying 8 migrations..." | jq -r .id)

echo "Created island notification: $ID"

# Advance the progress. In a real task these updates follow real milestones.
for step in 1 2 3 4 5 6 7 8; do
  sleep 1
  pct=$(echo "scale=2; $step / 8" | bc)
  syncfu update "$ID" \
    --progress "$pct" \
    --progress-label "migration $step of 8"
done

# Final state, then let it settle before clearing.
syncfu update "$ID" --progress 1.0 --body "All 8 migrations applied." --progress-label "done"
sleep 2
syncfu dismiss "$ID"
echo "Done."
