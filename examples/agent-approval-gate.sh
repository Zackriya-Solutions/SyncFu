#!/usr/bin/env bash
# agent-approval-gate.sh
#
# Ask the human to approve an action on the notch notification, then branch on the
# answer. This is the pattern an AI agent uses to gate risky work (deploys,
# destructive commands, spending) on a real human decision.
#
# `--wait` blocks until the human resolves the notification, then the CLI exits:
#   0  an action button was clicked  (stdout = the action id, e.g. "approve")
#   1  the card was dismissed        (hover the x on the expanded card)
#   2  nobody answered before --wait-timeout elapsed (the island-specific
#      "unanswered" outcome: an island decision stays expanded and never
#      auto-dismisses, so an unanswered decision can only time out -> 2)
#
# Requires the syncfu desktop app running (HTTP server on :9868).

set -euo pipefail

# Send the decision to the island and capture the clicked action id on stdout.
# `&& CODE=0 || CODE=$?` keeps `set -e` from aborting on a non-zero exit while
# capturing the REAL exit code (a bare `|| true; CODE=$?` would always read 0,
# the exit code of `true`).
ACTION=$(syncfu send \
  --presentation island \
  -t "Deploy to production?" \
  -s deploy-agent \
  -i rocket \
  -a "approve:Approve:primary" \
  -a "reject:Reject:danger" \
  --wait --wait-timeout 120 \
  "Ship v2.3.0 to prod. 41 commits since the last release.") && CODE=0 || CODE=$?

case "$CODE" in
  0)
    echo "Human chose: $ACTION"
    if [ "$ACTION" = "approve" ]; then
      echo "-> running deploy..."
      # ./deploy.sh prod
    else
      echo "-> deploy rejected, stopping."
    fi
    ;;
  1) echo "Dismissed without deciding. Treating as abort." ;;
  2) echo "No answer within 120s. Treating as abort." ;;
  *) echo "Unexpected exit code $CODE (is the app running on :9868?)" ;;
esac
