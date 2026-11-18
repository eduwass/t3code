#!/usr/bin/env bash
# Build the user's published fork and stage it on Omarchy, without rebasing it.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
build="${T3FORK_OMARCHY_BUILD_DIR:-$HOME/Sites/t3code-omarchy-build}"
cache="${T3FORK_OMARCHY_CACHE:-$HOME/.cache/t3space-omarchy}"
host="${T3FORK_OMARCHY_HOST:-omarchypc}"
mac="${T3FORK_MAC:-eduwass@macbook-max}"
export PATH="$HOME/.local/share/fnm:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.cargo/bin:$PATH"
mkdir -p "$cache"
chmod 700 "$cache"
exec 8>"$cache/update.lock"
flock -n 8 || exit 0
cd "$repo"
git fetch --quiet origin stack
commit=$(git rev-parse 'origin/stack^{commit}')
short=${commit:0:12}
artifact="$cache/build-$short/linux-unpacked"
if [[ ! -x "$artifact/t3code" || ! -f "$cache/build-$short/complete" ]]; then
  if [[ -d "$build" ]]; then
    [[ -z $(git -C "$build" status --porcelain --untracked-files=no) ]] || { echo 'Build checkout has local changes; refusing to discard them.' >&2; exit 1; }
    git -C "$build" checkout --quiet --detach "$commit"
  else
    git worktree add --quiet --detach "$build" "$commit"
  fi
  node_version=$(node -p 'require(process.argv[1]).engines.node' "$build/package.json")
  version=$(git describe --tags --match 'v*-nightly.*' --abbrev=0 "$commit")
  fnm install "$node_version"
  cp "$build/.env.example" "$build/.env"
  (
    cd "$build"
    fnm exec --using "$node_version" env pnpm_config_pm_on_fail=ignore pnpm install --frozen-lockfile --filter @t3tools/desktop... --filter t3... --filter @t3tools/web... --filter @t3tools/scripts...
    fnm exec --using "$node_version" env PATH="$build/node_modules/.bin:$PATH" CARGO_BUILD_JOBS=2 T3CODE_TELEMETRY_CHANNEL=dev node scripts/build-desktop-artifact.ts --platform linux --target dir --arch x64 --build-version "${version#v}" --output-dir "$cache/build-$short" --verbose
  )
  touch "$cache/build-$short/complete"
fi

# Refresh the Max's portable settings when reachable; keep the last snapshot if asleep.
if ssh -o BatchMode=yes -o ConnectTimeout=10 "$mac" true; then
  snapshot=$(mktemp -d "$cache/profile.XXXXXX")
  trap 'rm -rf "$snapshot"' EXIT
  ssh "$mac" 'tar -C "$HOME/.t3space/userdata" -cf - client-settings.json keybindings.json keybindings-migrations desktop-settings.json settings.json themes' | tar -xf - -C "$snapshot"
  ssh "$mac" 'tar -C "$HOME/Library/Application Support/t3space" -cf - "Local Storage"' | tar -xf - -C "$snapshot"
  (
    cd "$build/apps/desktop"
    PROFILE_SNAPSHOT="$snapshot" fnm exec --using "$(node -p 'require("../../package.json").engines.node')" node --input-type=module <<'JS'
import fs from 'node:fs';
import * as Effect from 'effect/Effect';
import * as NodeServices from '@effect/platform-node/NodeServices';
import {readChromiumLocalStorage} from './src/app/chromiumLocalStorage.ts';
const dir=process.env.PROFILE_SNAPSHOT;
const items=await Effect.runPromise(readChromiumLocalStorage(`${dir}/Local Storage/leveldb`,'t3code://app').pipe(Effect.provide(NodeServices.layer)));
const preferences=Object.fromEntries([...items].filter(([key]) =>
  !/clientId|device-id|composer-drafts|browser-history|browser-favicons|pullRequests\.(detail|list|recent)|closed-views|right-panel-state|diff-panel-state/.test(key)));
fs.writeFileSync(`${dir}/local-storage.json`,JSON.stringify(preferences),{mode:0o600});
for(const file of ['client-settings.json','keybindings.json','desktop-settings.json','settings.json']) JSON.parse(fs.readFileSync(`${dir}/${file}`,'utf8'));
console.log(`Exported ${preferences ? Object.keys(preferences).length : 0} portable preferences.`);
JS
  )
  rm -rf "$snapshot/Local Storage"
  (cd "$snapshot"; find . -type f ! -name fingerprint -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1 >fingerprint)
  mkdir -p "$cache/profile"
  rsync -a --delete "$snapshot/" "$cache/profile/"
else
  echo 'MacBook Max is asleep; retaining its last settings snapshot.'
fi
[[ -f "$cache/profile/fingerprint" ]] || { echo 'No Mac settings snapshot available yet.' >&2; exit 1; }

profile_id=$(cat "$cache/profile/fingerprint")
ssh -o BatchMode=yes -o ConnectTimeout=15 "$host" 'mkdir -p ~/.local/share/t3space/releases ~/.local/lib/t3space ~/.local/bin ~/.local/share/applications ~/.cache/t3space-profiles; chmod 700 ~/.cache/t3space-profiles'
# Completed releases and profiles are immutable: launchers may be using either.
if ! ssh "$host" "test -f ~/.local/share/t3space/releases/$short/.complete"; then
  rsync -az --delete "$artifact/" "$host:.local/share/t3space/releases/$short/"
  ssh "$host" "touch ~/.local/share/t3space/releases/$short/.complete"
fi
if ! ssh "$host" "test -f ~/.cache/t3space-profiles/$profile_id/.complete"; then
  rsync -az --delete "$cache/profile/" "$host:.cache/t3space-profiles/$profile_id/"
  ssh "$host" "touch ~/.cache/t3space-profiles/$profile_id/.complete"
fi
scp -q "$repo/fork/omarchy-launch.sh" "$host:.local/bin/t3space.next"
scp -q "$repo/fork/omarchy-import.mjs" "$host:.local/lib/t3space/import.mjs.next"
scp -q "$repo/fork/omarchy-keybindings.lua" "$host:.config/hypr/t3space.lua.next"
ssh "$host" bash -s -- "$short" "$commit" "$profile_id" <<'REMOTE'
set -euo pipefail
short=$1 commit=$2 profile_id=$3
root="$HOME/.local/share/t3space"
chmod +x ~/.local/bin/t3space.next
mv ~/.local/bin/t3space.next ~/.local/bin/t3space
mv ~/.local/lib/t3space/import.mjs.next ~/.local/lib/t3space/import.mjs
if ! cmp -s ~/.config/hypr/t3space.lua.next ~/.config/hypr/t3space.lua; then
  mv ~/.config/hypr/t3space.lua.next ~/.config/hypr/t3space.lua
  hyprctl -i 0 reload || true
else
  rm ~/.config/hypr/t3space.lua.next
fi
ln -sfn "t3space-profiles/$profile_id" ~/.cache/t3space-profile-current.next
mv -Tf ~/.cache/t3space-profile-current.next ~/.cache/t3space-profile-current
ln -sfn "releases/$short" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
printf '%s\n' "$commit" > "$root/installed-commit"
cat > ~/.local/share/applications/t3space.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=T3 Space
Comment=Your T3 Space fork
Exec=$HOME/.local/bin/t3space %U
Icon=$HOME/.local/share/icons/com.t3tools.T3Code.desktop.png
StartupWMClass=com.t3tools.T3Code
Terminal=false
Categories=Development;
MimeType=x-scheme-handler/t3space;
DESKTOP
update-desktop-database ~/.local/share/applications
REMOTE
echo "T3 Space $short installed on $host; settings apply at next launch."
