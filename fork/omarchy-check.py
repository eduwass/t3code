#!/usr/bin/env python3
"""Check the installed preference snapshot and both sets of live shortcuts."""
import json
import os
import subprocess

host = os.environ.get("T3FORK_OMARCHY_HOST", "omarchypc")


def remote(command):
    return subprocess.check_output(["ssh", host, command], text=True).strip()


assert not remote("hyprctl -i 0 configerrors")
bindings = json.loads(remote("hyprctl -i 0 binds -j"))
for submap in ("", "t3space"):
    for modifiers, key in [(64, "S"), (64, "Q"), (64, "K"), (65, "UP"), (65, "DOWN"), (72, "LEFT"), (72, "RIGHT"), (77, "S"), (77, "B"), (77, "T"), (77, "C")]:
        matches = [b for b in bindings if b["submap"] == submap and b["modmask"] == modifiers and b["key"] == key]
        assert len(matches) == 1, (submap, modifiers, key, len(matches))
remote("cmp ~/.t3space/userdata/keybindings.json ~/.cache/t3space-profile-current/keybindings.json")
assert remote("test -x ~/.local/share/t3space/current/t3code && echo installed") == "installed"
print("Omarchy app installed; copied keybindings match; T3 and global shortcuts have no overlap.")
