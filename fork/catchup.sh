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
# The log says "done <status>" once the server is switched. Then, for up to 18 hours, the
# unit retries every 10 minutes what a locked phone or an asleep Mac missed, and logs "apps: ...".
# A failure that needs judgment (rebase conflict, server switch) opens a T3 thread for it.
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=${T3FORK_CATCHUP_LOG:-$HOME/.t3/fork-catchup.log}

# Plain shell on purpose: waiting for a device needs no agent.
retry_apps() {
  local mac=waiting ios=waiting end=$((SECONDS + 18 * 3600))
  if fork/mac.sh status >/dev/null 2>&1; then mac=ok; fi
  git config fork-ios.pending >/dev/null || ios=ok
  while [ "$mac$ios" != okok ] && [ $SECONDS -lt $end ]; do
    sleep 600
    if [ $ios != ok ] && fork/ios.sh retry; then ios=ok; fi
    if [ $mac != ok ] && fork/mac.sh install; then mac=ok; fi
  done
  echo "apps: iphone $ios, mac $mac"
}

# Hands a failure to a new T3 thread; the only time a catch-up needs an agent.
open_thread() {
  local id
  id=$(t3 thread start --provider "${T3FORK_AGENT_PROVIDER:-claudeAgent}" --model "${T3FORK_AGENT_MODEL:-claude-opus-5-5}" \
    --title "Fork catch-up: $1" . "The daily fork catch-up to $target failed: $1.
Log: ~/.t3/fork-catchup.log. Read fork/README.md and the fork-stack skill, then fix it in this
checkout (/home/eduwass/Sites/t3code, branch stack). A rebase conflict is left in progress:
keep upstream's new code, re-apply what each patch meant, git rebase --continue,
bash ~/.claude/skills/fork-stack/fork-stack.sh verify, git push --force-with-lease origin stack,
then run fork/catchup.sh start to finish the catch-up. If you cannot fix it with confidence,
git rebase --abort and ask me with AskUserQuestion. No AI attribution in commits. Never use
t3 update or edit the server's systemd drop-ins. End with one line on what you did.") &&
    echo "thread $id" || echo "could not start a thread"
}

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
    if fork/server.sh; then
      echo "done ok: server $(fork/server.sh base), apps $apps"
    else
      echo "done failed: server switch (it rolled back by itself), apps $apps"
      open_thread "the server switch failed"
    fi
  else
    echo "done failed: the stack did not rebase onto $target; server unchanged"
    open_thread "the stack did not rebase cleanly"
  fi
  retry_apps
  ;;
*)
  echo "usage: fork/catchup.sh status | start | run" >&2
  exit 2
  ;;
esac
