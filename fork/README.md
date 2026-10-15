# This fork

Upstream T3 Code plus a short stack of commits on the `stack` branch, replayed on
upstream with a rebase (never a merge). `git log <base>..stack` is the full list of
what differs; there is no other record. Everything under `fork/` exists only here.

## Rebuild the iPhone app

```sh
fork/ios.sh            # from the devbox, on the stack branch
```

It rebases the stack onto the base, runs the checks and pushes `stack` to `origin`
(a force push, because the rebase rewrites it). The push starts
`.github/workflows/fork-ios.yml`, which compiles an unsigned Release app on a
GitHub-hosted Mac in about 25 minutes. The script then downloads it, signs it on the
13" MacBook with the team's development certificate and installs it on the phone
over Wi-Fi. That Mac must be awake and logged in. A rebase conflict stops it:
resolve, `git rebase --continue`, run it again.

When the phone is not on the Mac's network, the script serves the signed build
from the devbox and prints a tailnet link instead. Open it on the phone with
Tailscale on and tap Install.

The compile is hosted because upstream's native code needs a newer Xcode (26.6 works) and
that Mac is held at 26.3 by macOS 15. Once it runs a newer macOS and Xcode, the
build can move back onto it and the workflow can go.

The push has to go over SSH (`git remote set-url --push origin git@github.com:eduwass/t3code.git`):
upstream edits its workflow files, and GitHub rejects those from the `gh` HTTPS token.

`fork/ios.sh status` exits 0 when the installed build matches the server, 1 when
the server has moved on, and 2 when the protocol version changed, which is the
case where the app refuses to connect until it is rebuilt.

## Which upstream commit

The base is the nightly tag the running devbox server is on (`fork/ios.sh tag`), so the app
and the server share one set of contracts. The app refuses a server whose
`ORCHESTRATION_PROTOCOL_VERSION` differs; within one protocol version, upstream's App Store
build runs against older and newer servers alike. Pass another ref to override:
`fork/ios.sh rebuild upstream/main`.

The base is stamped into the build number: `20261013.3042` is
`v0.0.46-nightly.20261013.3042`, and a third component counts commits past that
tag. To read it off the phone:

```sh
ssh eduwass@macbook-pro xcrun devicectl device info apps \
  --device "iPhone 13 Pro Max de Edu" --bundle-id com.eduwass.t3code
```

`git config fork-ios.installed` holds the same commit on the devbox.

## What the build is

Upstream's Nightly variant with its Personal Team switch, signed by team
`U5XY5MYRXF` under `com.eduwass.t3code` with a development profile that expires
on 2027-10-14, so it sits beside the App Store app as
"T3 Code Preview". That switch leaves out the widgets, the share extension, push
notifications and Sign in with Apple. Over-the-air updates are off, since they
would swap the fork's JavaScript for upstream's.

Cloud transcription is set on the phone in Settings, Voice input, Cloud service.
For Groq: `https://api.groq.com/openai/v1/audio/transcriptions`, model
`whisper-large-v3-turbo`, and the API key, which stays in the phone's Keychain.

## Rebuild the Mac app

```sh
fork/mac.sh            # from the devbox, on the stack branch
```

T3 Space is the desktop app with the fork's patches, installed on the MacBook
Max beside the official T3 Code as `/Applications/T3 Space (Nightly).app`. It has its own app
ID (`com.eduwass.t3space`), profile and T3 home (`~/.t3space`), and registers
`t3space://` rather than `t3code://`, so it cannot touch the official app's
state or take its sign-in links. Turn off its local environment in Settings
and pair it with the devbox server, the same way as the official app.

`fork/mac.sh install` installs the newest finished build again, for when the Mac
was asleep during a rebuild. `fork/mac.sh status` says whether the installed
build is behind the server, and `fork/mac.sh rollback` puts the previous build
back.

The script rebases the stack onto the nightly the devbox server runs, runs the
checks, pushes `stack`, then pushes the same commit to `mac/<version>`. That
push starts `.github/workflows/fork-mac.yml`, which packages an unsigned arm64
app on a GitHub-hosted Mac. The script downloads it, deletes the branch and hands it to
`fork/mac-install.sh` on the Mac, which signs it ad hoc and replaces the app in
`/Applications`. It never quits T3 Space: while the app is open the new build
waits and goes in when it quits, so your windows stay put.
The build has no update feed, so it never updates itself into the official app.
