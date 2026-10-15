#!/usr/bin/env bash
# Runs on the Mac; fork/mac.sh copies it there next to the build. Never closes
# T3 Space: while it is open, a new build waits and replaces it once it quits.
# The replaced app is kept for rollback.
#
#   install.sh <app name> <dir> install    unpack <dir>/app.zip, then install or wait for quit
#   install.sh <app name> <dir> version    version that is installed, or waiting to be
#   install.sh <app name> <dir> rollback   put the previous build back
set -euo pipefail
cd ~
name=$1 dir=$2 mode=$3
app="/Applications/$name.app" self="$dir/install.sh"
running() { [ "$(osascript -e "application \"$name\" is running")" = true ]; }
# plutil, not defaults: defaults treats a relative path (the staged build) as a domain name.
version() { plutil -extract CFBundleShortVersionString raw "$1/Contents/Info.plist"; }

case $mode in
install)
  # A build still waiting from an earlier run is replaced by this one.
  [ ! -f "$dir/waiter.pid" ] || kill "$(cat "$dir/waiter.pid")" 2>/dev/null || true
  rm -rf "$dir/waiter.pid" "$dir/new" && mkdir "$dir/new"
  ditto -x -k "$dir/app.zip" "$dir/new" && rm "$dir/app.zip"
  xattr -cr "$dir/new/$name.app"
  codesign --force --deep -s - "$dir/new/$name.app" 2>/dev/null
  if running; then
    nohup bash "$self" "$name" "$dir" swap-when-quit >/dev/null 2>&1 &
    echo $! >"$dir/waiter.pid"
    echo "staged: installs when $name quits"
  else
    bash "$self" "$name" "$dir" swap
    echo "installed $app"
  fi
  ;;
swap-when-quit)
  while running; do sleep 30; done
  rm -f "$dir/waiter.pid"
  exec bash "$self" "$name" "$dir" swap
  ;;
swap)
  [ -d "$dir/new/$name.app" ]
  rm -rf "$dir/previous.app"
  [ ! -d "$app" ] || mv "$app" "$dir/previous.app"
  mv "$dir/new/$name.app" "$app" && rm -rf "$dir/new"
  ;;
version)
  if [ -d "$dir/new/$name.app" ]; then version "$dir/new/$name.app"; else version "$app"; fi
  ;;
rollback)
  [ -d "$dir/previous.app" ] || { echo "no previous build kept" >&2; exit 1; }
  ! running || { echo "quit $name first" >&2; exit 1; }
  [ ! -f "$dir/waiter.pid" ] || kill "$(cat "$dir/waiter.pid")" 2>/dev/null || true
  rm -rf "$dir/waiter.pid" "$dir/new"
  mv "$app" "$dir/rolled-back.app.tmp" && mv "$dir/previous.app" "$app"
  rm -rf "$dir/rolled-back.app.tmp"
  echo "back on $(version "$app")"
  ;;
*) echo "unknown mode $mode" >&2; exit 1 ;;
esac
