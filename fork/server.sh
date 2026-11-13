#!/usr/bin/env bash
# Builds the fork's T3 server for this Linux machine and switches the background
# service to it, so server-side fork features (Paper) run on the real server.
#
#   fork/server.sh [ref]   build ref (default origin/stack) and switch the service to it
#   fork/server.sh base    the upstream nightly the running fork server was built on
#
# The fork build is named <base nightly> with the run number raised past 900000, e.g.
# 0.1.8-nightly.20261107.900001: the updater only takes plain nightly names, it sorts
# after its base, and no real nightly reaches that run number. `t3 update` moves back
# to upstream (and drops the fork's server features); the switch rolls back by itself
# when the new server fails to start.
set -euo pipefail
cd "$(dirname "$0")/.."

T3=${T3FORK_T3:-$HOME/.local/bin/t3}
HOME_DIR=${T3CODE_HOME:-$HOME/.t3}
BUILD_DIR=${T3FORK_SERVER_BUILD_DIR:-$(cd .. && pwd)/t3code-server-build}
FORK_RUN=900000
# The single executable needs this exact Node (see `cli.ts build-exe --help`); `fnm install` it.
SEA_NODE=${T3FORK_SEA_NODE:-26.12.1}

die() {
  echo "fork-server: $*" >&2
  exit 1
}

running_version() {
  sed -n 's/.*"activeVersion": *"\([^"]*\)".*/\1/p' "$HOME_DIR/runtime/service-state.json"
}

if [ "${1:-}" = base ]; then
  git config fork-server.base || die "no fork server recorded"
  exit 0
fi

ref=${1:-origin/stack}
git fetch --quiet origin
git fetch --quiet --tags upstream
commit=$(git rev-parse "$ref^{commit}")
base=$(git describe --tags --match 'v*-nightly.*' --abbrev=0 "$commit")
[[ $base =~ ^v(.+-nightly\.[0-9]{8})\.([0-9]+)$ ]] || die "cannot read the base nightly '$base'"
prefix=${BASH_REMATCH[1]}
current=$(running_version)
n=$((FORK_RUN + 1))
[[ $current =~ ^${prefix//./\\.}\.([0-9]+)$ ]] && ((BASH_REMATCH[1] > FORK_RUN)) &&
  n=$((BASH_REMATCH[1] + 1))
version="$prefix.$n"
echo "fork-server: building $(git rev-parse --short "$commit") on $base as $version"

# A separate checkout, so the build never touches a checkout someone works in.
if [ -d "$BUILD_DIR" ]; then
  git -C "$BUILD_DIR" checkout --quiet --force --detach "$commit"
  git -C "$BUILD_DIR" clean -fdq -e node_modules -e .env
else
  git worktree add --quiet --detach "$BUILD_DIR" "$commit"
fi
cp .env.example "$BUILD_DIR/.env"
(
  cd "$BUILD_DIR"
  export PATH=$PWD/node_modules/.bin:$PATH
  pnpm_config_pm_on_fail=ignore pnpm install --frozen-lockfile >/dev/null
  node scripts/update-release-package-versions.ts "$version" >/dev/null
  T3CODE_TELEMETRY_CHANNEL=dev vp run build:desktop:bundle
  node scripts/apply-web-brand-assets.ts nightly apps/server/dist/client
  fnm exec --using "$SEA_NODE" node apps/server/scripts/cli.ts build-exe
  # The resource monitor is a Rust binary the fork does not change; reuse the running one's.
  monitor=$(mktemp -d)
  cp -R "$HOME_DIR/runtime/versions/$current/resource-monitor/." "$monitor/"
  rm -rf release-cli
  node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$version" \
    --resource-monitor-dir "$monitor" --output-dir release-cli
  node scripts/smoke-cli-archive.ts --archive release-cli/* --expect-version "$version"
  git checkout --quiet -- .
)

# `t3 update` downloads from the release feed; this feed serves the one archive built here.
feed=$(mktemp -d)
mkdir -p "$feed/v$version"
cp "$BUILD_DIR"/release-cli/* "$feed/v$version/"
(cd "$feed/v$version" && sha256sum -- * >SHA256SUMS)
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$feed" >/dev/null 2>&1 &
feed_pid=$!
trap 'kill $feed_pid 2>/dev/null; rm -rf "$feed"' EXIT
sleep 1

git config fork-server.base "$base"
T3CODE_RELEASE_BASE_URL="http://127.0.0.1:$port" "$T3" update "$version" --yes
