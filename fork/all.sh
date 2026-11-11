#!/usr/bin/env bash
# Rebuilds the iPhone and Mac apps together: syncs and pushes the stack once, then runs
# fork/ios.sh and fork/mac.sh side by side. They install on different Macs.
#
#   fork/all.sh [base]   (T3FORK_NOTES and T3FORK_FULL pass through)
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(git branch --show-current)" = stack ] || { echo "fork-all: switch to the stack branch first" >&2; exit 1; }
git fetch --quiet --tags upstream
base=${1:-$(fork/ios.sh tag)}
git config fork-stack.upstream "$base"
git config fork-stack.check "fork/ios.sh check"
bash "${FORK_STACK:-$HOME/.claude/skills/fork-stack/fork-stack.sh}" sync
git push --force-with-lease origin stack
# main tracks the stack's base so "Changes vs main" counts only the fork's commits.
git push --quiet origin "$base^{commit}:refs/heads/main" && git branch -f main "$base" ||
  echo "fork-all: main not moved to $base (would go backwards?)" >&2

export T3FORK_SYNCED=1
fork/ios.sh rebuild "$base" &
ios=$!
fork/mac.sh "$base" &
mac=$!
status=0
wait "$ios" || { echo "fork-all: the iPhone build failed" >&2; status=1; }
wait "$mac" || { echo "fork-all: the Mac build failed" >&2; status=1; }
exit "$status"
