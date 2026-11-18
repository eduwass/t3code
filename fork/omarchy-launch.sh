#!/usr/bin/env bash
set -euo pipefail
root="$HOME/.local/share/t3space"
profile=$(readlink -f "$HOME/.cache/t3space-profile-current")
state="$HOME/.t3space/userdata"
export T3CODE_DESKTOP_LAUNCHER_PATH="$HOME/.local/bin/t3space"
umask 077
mkdir -p "$root" "$state"
chmod 700 "$state"
exec 9>"$root/session.lock"
if ! flock -n 9; then
  exec "$root/current/t3code" --class=t3space "$@"
fi
umask 077
changed=no
if [[ -f "$profile/fingerprint" ]] && ! cmp -s "$profile/fingerprint" "$root/applied-profile"; then
  mkdir -p "$root/previous-settings"
  for file in client-settings.json keybindings.json keybindings-migrations settings.json; do
    [[ ! -f "$state/$file" ]] || cp "$state/$file" "$root/previous-settings/$file"
    [[ ! -f "$profile/$file" ]] || cp "$profile/$file" "$state/$file"
  done
  # The Mac's screen coordinates do not fit the TV. Keep Linux window bounds.
  python3 - "$profile/desktop-settings.json" "$state/desktop-settings.json" <<'PY'
import json, pathlib, sys
source, target = map(pathlib.Path, sys.argv[1:])
settings = json.loads(source.read_text())
settings.pop('mainWindowBounds', None)
if target.exists():
    bounds = json.loads(target.read_text()).get('mainWindowBounds')
    if bounds: settings['mainWindowBounds'] = bounds
target.write_text(json.dumps(settings))
PY
  [[ ! -d "$profile/themes" ]] || cp -R "$profile/themes" "$state/"
  changed=yes
fi
if [[ "$changed" == yes ]]; then
  log="$root/startup-import.log"
  : >"$log"
  "$root/current/t3code" --class=t3space --inspect=127.0.0.1:0 "$@" >>"$log" 2>&1 &
  app_pid=$!
  if node "$HOME/.local/lib/t3space/import.mjs" "$log" "$profile" >>"$log" 2>&1; then
    cp "$profile/fingerprint" "$root/applied-profile"
  fi
else
  "$root/current/t3code" --class=t3space "$@" &
  app_pid=$!
fi
wait "$app_pid"
