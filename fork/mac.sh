#!/usr/bin/env bash
# Rebuilds the fork's T3 Space desktop app on the upstream commit the T3 Code
# server runs and installs it on the Mac. Usage and reasoning: fork/README.md.
#
#   fork/mac.sh [base]   rebase the stack, check, push, build on a hosted Mac, install
#   fork/mac.sh install  install the newest finished build again (after the Mac was asleep)
#   fork/mac.sh status   is the installed build behind the server? (0 current, 1 behind, 3 Mac unreachable)
#   fork/mac.sh rollback put the previous build back
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH=stack
REPO=${T3FORK_REPO:-eduwass/t3code}
MAC=${T3FORK_MAC:-eduwass@macbook-max} # T3FORK_MAC=eduwass@macbook-pro installs on the 13" instead
MAC_DIR=${T3FORK_MAC_DIR:-Library/Caches/t3space-fork} # relative to the Mac's home
APP="T3 Space (Nightly)"
FORK_STACK=${FORK_STACK:-$HOME/.claude/skills/fork-stack/fork-stack.sh}

die() {
  echo "fork-mac: $*" >&2
  exit 1
}

# Runs fork/mac-install.sh on the Mac, which does the installing (see there).
on_mac() {
  ssh -o ConnectTimeout=15 "$MAC" "mkdir -p '$MAC_DIR'" ||
    die "cannot reach $MAC (asleep?); run fork/mac.sh install once it is awake"
  scp -q fork/mac-install.sh "$MAC:$MAC_DIR/install.sh"
  ssh "$MAC" "bash '$MAC_DIR/install.sh' '$APP' '$MAC_DIR' $1"
}

# Copies a downloaded build to the Mac. It installs at once if T3 Space is closed,
# otherwise when it next quits, so an install never closes its windows.
install_on_mac() {
  local run=$1 tmp
  ssh -o ConnectTimeout=15 "$MAC" true || die "cannot reach $MAC (asleep?); run fork/mac.sh install once it is awake"
  tmp=$(mktemp -d)
  gh run download "$run" -R "$REPO" --name mac-app --dir "$tmp"
  ssh "$MAC" "mkdir -p '$MAC_DIR'"
  scp -q "$tmp"/*.zip "$MAC:$MAC_DIR/app.zip"
  rm -rf "$tmp"
  echo "fork-mac: $(on_mac install)"
}

case ${1:-} in
status)
  installed=$(on_mac version 2>/dev/null) || { echo "mac: unreachable"; exit 3; }
  server=$(fork/ios.sh tag)
  echo "installed: v$installed"
  echo "server:    $server"
  git fetch --quiet --tags upstream
  git merge-base --is-ancestor "$server" "v$installed" 2>/dev/null || exit 1
  exit 0
  ;;
rollback)
  on_mac rollback
  exit 0
  ;;
esac

if [ "${1:-}" = install ]; then
  read -r run sha < <(gh run list -R "$REPO" --status success --limit 50 \
    --json databaseId,workflowName,headSha \
    -q '[.[] | select(.workflowName == "Fork Mac build")][0] | "\(.databaseId) \(.headSha)"') ||
    die "no finished Mac build; run fork/mac.sh"
  echo "fork-mac: installing the build of ${sha:0:10}"
  install_on_mac "$run"
  exit 0
fi

[ "$(git branch --show-current)" = "$BRANCH" ] || die "switch to the $BRANCH branch first"
git fetch --quiet --tags upstream
base=${1:-$(fork/ios.sh tag)}
git rev-parse -q --verify "$base^{commit}" >/dev/null || die "unknown base '$base'"
version=$(git describe --tags --match 'v*-nightly.*' --abbrev=0 "$base")
version=${version#v}

git config fork-stack.upstream "$base"
git config fork-stack.check "fork/ios.sh check"
bash "$FORK_STACK" sync
git push --force-with-lease origin "$BRANCH"

# The push to mac/<version> starts .github/workflows/fork-mac.yml. gh finds runs by workflow
# file only on the default branch, so the run is found by its branch.
head=$(git rev-parse HEAD)
git push --force origin "HEAD:refs/heads/mac/$version"
echo "fork-mac: waiting for the hosted build of $(git rev-parse --short HEAD) as $version"
until run=$(gh run list -R "$REPO" --branch "mac/$version" --commit "$head" \
  --limit 1 --json databaseId -q '.[0].databaseId') && [ -n "$run" ]; do sleep 10; done
gh run watch "$run" -R "$REPO" --interval 30 --exit-status >/dev/null ||
  die "hosted build failed: gh run view $run -R $REPO --log-failed"
git push --quiet origin --delete "mac/$version" || true
install_on_mac "$run"
git config fork-mac.installed "$(git rev-parse "$base^{commit}")"
