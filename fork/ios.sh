#!/usr/bin/env bash
# Rebuilds this fork's iPhone app on the upstream commit the T3 Code server runs
# and installs it on the phone. Usage and reasoning: fork/README.md.
#
#   fork/ios.sh [rebuild] [base]   rebase the stack, check, push, build, sign, install
#   fork/ios.sh status             is the installed build behind the server? (exit 0/1/2)
#   fork/ios.sh check              install deps, then typecheck, test and lint what the stack touches
#   fork/ios.sh install NUMBER [DEVICE]  (run by rebuild, on the Mac) sign app.zip beside this script and install it
set -euo pipefail
cd "$(dirname "$0")"

BRANCH=stack
REPO=${T3FORK_REPO:-eduwass/t3code}
MAC=${T3FORK_MAC:-eduwass@macbook-pro}
MAC_DIR=${T3FORK_MAC_DIR:-Library/Caches/t3code-fork} # relative to the Mac's home
TEAM=${T3FORK_TEAM:-U5XY5MYRXF}
BUNDLE_ID=${T3FORK_BUNDLE_ID:-com.eduwass.t3code}
DEVICE=${T3FORK_DEVICE:-iPhone 13 Pro Max de Edu}
# Where the phone fetches a build it cannot get over Wi-Fi. The devbox tunnel
# publishes every local port at this tailnet-only HTTPS origin.
OTA_URL=${T3FORK_OTA_URL:-https://devbox.tailf24f3e.ts.net:4488}
OTA_DIR=$HOME/.cache/t3code-fork-ota
FORK_STACK=${FORK_STACK:-$HOME/.claude/skills/fork-stack/fork-stack.sh}
JOB=dev.t3fork.ios
TOUCHED=(
  apps/mobile/src/features/voice-input
  apps/mobile/src/features/settings
  apps/mobile/src/native
  apps/mobile/src/persistence
  packages/client-runtime/src/voice-input
)

die() {
  echo "fork-ios: $*" >&2
  exit 1
}

# The nightly tag of the server the phone connects to, e.g. v0.0.46-nightly.20261013.3042.
server_tag() {
  t3 --version | awk '{ print $2 }'
}

protocol() {
  git show "$1:packages/contracts/src/environment.ts" |
    sed -n 's/^export const ORCHESTRATION_PROTOCOL_VERSION = \([0-9]*\);/\1/p'
}

cmd_check() {
  pnpm install --frozen-lockfile --filter '@t3tools/mobile...' \
    --filter '@t3tools/client-runtime...' --filter ./oxlint-plugin-t3code --filter . >/dev/null
  PATH=$PWD/node_modules/.bin:$PATH
  vp run --filter @t3tools/mobile --filter @t3tools/client-runtime typecheck
  vp test run "${TOUCHED[@]}"
  vp lint "${TOUCHED[@]}"
}

cmd_status() {
  local installed server
  git fetch --quiet --tags upstream
  installed=$(git config fork-ios.installed || true)
  server=$(server_tag)
  echo "installed: $([ -n "$installed" ] && git describe --tags --match 'v*-nightly.*' "$installed" || echo nothing recorded)"
  echo "server:    $server"
  [ -n "$installed" ] || return 1
  if [ "$(protocol "$installed")" != "$(protocol "$server")" ]; then
    echo "protocol changed: the app cannot connect until it is rebuilt"
    return 2
  fi
  # A build at or ahead of the server is current; only a server that moved past it is not.
  git merge-base --is-ancestor "$server" "$installed" || return 1
}

cmd_rebuild() {
  local base described number run tmp result port
  [ "$(git branch --show-current)" = "$BRANCH" ] || die "switch to the $BRANCH branch first"
  git fetch --quiet --tags upstream
  base=${1:-$(server_tag)}
  git rev-parse -q --verify "$base^{commit}" >/dev/null || die "unknown base '$base'"

  git config fork-stack.upstream "$base"
  git config fork-stack.check "fork/ios.sh check"
  bash "$FORK_STACK" sync
  git push --force-with-lease origin "$BRANCH"

  # The push starts .github/workflows/fork-ios.yml; an unchanged stack reuses its last run.
  echo "fork-ios: waiting for the hosted build of $(git rev-parse --short HEAD)"
  until run=$(gh run list -R "$REPO" --workflow fork-ios.yml --commit "$(git rev-parse HEAD)" \
    --limit 1 --json databaseId -q '.[0].databaseId') && [ -n "$run" ]; do sleep 10; done
  gh run watch "$run" -R "$REPO" --interval 30 --exit-status >/dev/null ||
    die "hosted build failed: gh run view $run -R $REPO --log-failed"
  tmp=$(mktemp -d)
  gh run download "$run" -R "$REPO" --name app --dir "$tmp" ||
    die "no artifact (they expire after 30 days): gh run rerun $run -R $REPO, then run this again"

  # CFBundleVersion: the nightly's date and run number, plus commits past it for a non-tag base.
  described=$(git describe --tags --match 'v*-nightly.*' "$base")
  number=$(sed -E 's/^.*nightly\.([0-9]+\.[0-9]+)(-([0-9]+)-g.*)?$/\1.\3/; s/\.$//' <<<"$described")

  # Signing needs the Mac's login keychain, which a plain SSH session cannot use;
  # launchd runs the install inside the logged-in session instead.
  ssh "$MAC" "mkdir -p '$MAC_DIR'"
  scp -q "$tmp/app.zip" fork/ios.sh "$MAC:$MAC_DIR/"
  rm -rf "$tmp"
  ssh "$MAC" "cd '$MAC_DIR' && { launchctl remove $JOB 2>/dev/null; : >install.log; } &&
    launchctl submit -l $JOB -o \"\$PWD/install.log\" -e \"\$PWD/install.log\" -- /bin/bash \"\$PWD/ios.sh\" install $number $(printf '%q' "$DEVICE")"
  until result=$(ssh "$MAC" "grep '^fork-ios: exit ' '$MAC_DIR/install.log'"); do sleep 5; done
  ssh "$MAC" "cat '$MAC_DIR/install.log'"
  case $result in
  "fork-ios: exit 0") echo "fork-ios: installed build $number ($described) on $DEVICE" ;;
  "fork-ios: exit 3")
    # The phone is not on the Mac's network. iOS installs a signed build from a
    # link as well, so serve it over the tailnet and let the phone fetch it.
    mkdir -p "$OTA_DIR"
    scp -q "$MAC:$MAC_DIR/app.ipa" "$OTA_DIR/"
    cat >"$OTA_DIR/manifest.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
  <key>assets</key><array><dict>
    <key>kind</key><string>software-package</string><key>url</key><string>$OTA_URL/app.ipa</string>
  </dict></array>
  <key>metadata</key><dict>
    <key>bundle-identifier</key><string>$BUNDLE_ID</string><key>bundle-version</key><string>$number</string>
    <key>kind</key><string>software</string><key>title</key><string>T3 Code fork $number</string>
  </dict>
</dict></array></dict></plist>
EOF
    echo "<meta name=viewport content='width=device-width'><body style='font:20px system-ui;padding:2em'>
<a href='itms-services://?action=download-manifest&url=$OTA_URL/manifest.plist'>Install T3 Code fork $number</a>" \
      >"$OTA_DIR/index.html"
    port=${OTA_URL##*:}
    ss -H -ltn | grep -q ":$port " ||
      setsid nohup python3 -m http.server "$port" --bind 127.0.0.1 --directory "$OTA_DIR" >/dev/null 2>&1 &
    echo "fork-ios: the phone is not on the Mac's network; open $OTA_URL/ on it (Tailscale on) and tap Install"
    ;;
  *) die "signing failed" ;;
  esac
  # ponytail: a link install is recorded as installed without knowing it was tapped.
  git config fork-ios.installed "$(git rev-parse "$base^{commit}")"
}

cmd_install() {
  local number=$1 device=${2:-$DEVICE} app profile identity item
  # launchd restarts a submitted job until it is removed.
  trap 'echo "fork-ios: exit $?"; launchctl remove $JOB' EXIT
  rm -rf app && mkdir app && ditto -x -k app.zip app
  app=$(echo app/*.app)

  # ponytail: reuses the team profile Xcode made for this bundle id, which lasts a year.
  # When it expires, any `xcodebuild -allowProvisioningUpdates` of an app with this
  # bundle id and team, run in the Mac's logged-in session, makes Xcode issue a new one.
  profile=$(grep -l -a "<string>$TEAM.$BUNDLE_ID</string>" \
    "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision | head -1)
  [ -n "$profile" ] || die "no provisioning profile for $BUNDLE_ID"
  security cms -D -i "$profile" >profile.plist
  identity=$(plutil -extract DeveloperCertificates.0 raw profile.plist | base64 -d | shasum | cut -d' ' -f1)
  cat >entitlements.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>$TEAM.$BUNDLE_ID</string>
  <key>com.apple.developer.team-identifier</key><string>$TEAM</string>
  <key>get-task-allow</key><true/>
  <key>keychain-access-groups</key><array><string>$TEAM.$BUNDLE_ID</string></array>
</dict></plist>
EOF

  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $number" "$app/Info.plist"
  cp "$profile" "$app/embedded.mobileprovision"
  for item in "$app"/Frameworks/*; do
    [ -e "$item" ] && codesign -f -s "$identity" "$item"
  done
  codesign -f -s "$identity" --entitlements entitlements.plist "$app"
  rm -rf Payload app.ipa && mkdir Payload && cp -R "$app" Payload/ &&
    ditto -c -k --keepParent Payload app.ipa && rm -rf Payload
  xcrun devicectl device install app --device "$device" "$app" || exit 3
}

command=${1:-rebuild}
case $command in
install) cmd_install "$2" "${3:-}" ;;
rebuild | status | check)
  cd ..
  "cmd_$command" "${2:-}"
  ;;
*) die "usage: fork/ios.sh [rebuild [base] | status | check]" ;;
esac
