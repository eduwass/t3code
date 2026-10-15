// @effect-diagnostics nodeBuiltinImport:off -- Fork-only: reads the Mac's stage directory and leaves a waiter running after the app quits.
// T3 Space has no update feed. fork/mac.sh stages a new build on the Mac and
// fork/mac-install.sh swaps it in when the app quits. This lets the sidebar's
// update pill show the staged build and restart into it.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { app } from "electron";

const STAGE_DIR = NodePath.join(NodeOS.homedir(), "Library", "Caches", "t3space-fork");

const plistString = (plist: string, key: string): string | null =>
  new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1] ?? null;

/** The version of the build waiting in the stage directory, if one differs from this app. */
export function stagedForkBuildVersion(currentVersion: string): string | null {
  try {
    const staged = NodeFS.readdirSync(NodePath.join(STAGE_DIR, "new")).find((name) =>
      name.endsWith(".app"),
    );
    if (staged === undefined) return null;
    const plist = NodeFS.readFileSync(
      NodePath.join(STAGE_DIR, "new", staged, "Contents", "Info.plist"),
      "utf8",
    );
    const version = plistString(plist, "CFBundleShortVersionString");
    return version !== null && version !== currentVersion ? version : null;
  } catch {
    return null;
  }
}

/**
 * Quits so the staged build goes in, then reopens. Starts its own waiter: the one
 * fork/mac.sh left may be gone after a reboot.
 */
export function restartIntoStagedForkBuild(): void {
  const script = NodePath.join(STAGE_DIR, "install.sh");
  const appName = NodePath.basename(
    NodePath.dirname(NodePath.dirname(NodePath.dirname(app.getPath("exe")))),
    ".app",
  );
  NodeFS.writeFileSync(NodePath.join(STAGE_DIR, "relaunch"), "");
  NodeChildProcess.spawn("/bin/bash", [script, appName, STAGE_DIR, "swap-when-quit"], {
    detached: true,
    stdio: "ignore",
  }).unref();
  app.quit();
}
