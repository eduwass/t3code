#!/usr/bin/env bash
# Moves the whole fork to the newest upstream nightly while the devbox runs the fork's
# own server: rebases the stack, builds both apps (fork/all.sh), then rebuilds and
# switches the server (fork/server.sh). The upkeep task runs this daily.
#
#   fork/catchup.sh status   print the newest nightly; exit 0 when the server is on it, 1 when behind
#   fork/catchup.sh start    run the catch-up as its own systemd unit and print its log path;
#                            the server restart at the end cannot kill it
#   fork/catchup.sh run      the catch-up itself (what `start` runs)
#
# The log ends with "done <status>" when finished. Apps on an asleep Mac fail without
# stopping the server switch; `fork/mac.sh install` / `fork/ios.sh` catch them up later.
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=${T3FORK_CATCHUP_LOG:-$HOME/.t3/fork-catchup.log}

newest() {
  git fetch --quiet --tags upstream
  git for-each-ref --count=1 --sort=-creatordate --merged upstream/main --format='%(refname:short)' 'refs/tags/v*-nightly.*'
}

case ${1:-} in
status)
  target=$(newest)
  current=$(fork/server.sh base 2>/dev/null || true)
  echo "server base: ${current:-none (not a fork server)}"
  echo "newest:      $target"
  [ "$current" = "$target" ]
  ;;
start)
  unit=fork-catchup-$(date +%H%M%S)
  systemd-run --user --quiet --unit "$unit" --working-directory "$PWD" \
    -E HOME="$HOME" -E PATH="$HOME/.local/bin:$HOME/.local/share/fnm:$HOME/.local/share/fnm/aliases/default/bin:/usr/local/bin:/usr/bin:/bin" \
    bash -c "fork/catchup.sh run >'$LOG' 2>&1"
  echo "$unit $LOG"
  ;;
run)
  echo "start $(date -Is)"
  [ "$(git branch --show-current)" = stack ] || { echo "done skipped: stack not checked out"; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "done skipped: checkout dirty"; exit 1; }
  target=$(newest)
  [ "$(fork/server.sh base)" != "$target" ] || { echo "done current: $target"; exit 0; }
  echo "target $target"
  apps=ok
  fork/all.sh "$target" || apps=failed
  echo "apps $apps"
  # Switch the server only when the rebase landed, else it would rebuild the old base.
  git fetch --quiet origin
  if git merge-base --is-ancestor "$target" origin/stack; then
    fork/server.sh && echo "done ok: server $(fork/server.sh base), apps $apps" ||
      echo "done failed: server switch (it rolls back by itself), apps $apps"
  else
    echo "done failed: the stack did not rebase onto $target; server unchanged"
  fi
  ;;
*)
  echo "usage: fork/catchup.sh status | start | run" >&2
  exit 2
  ;;
esac
