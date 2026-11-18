// Import portable renderer preferences at startup, then close the local inspector.
import * as NodeFSP from "node:fs/promises";
import * as NodeTimersPromises from "node:timers/promises";

const [log, profile] = process.argv.slice(2);
const deadline = Date.now() + 60_000;
let endpoint;
while (!endpoint && Date.now() < deadline) {
  endpoint = (await NodeFSP.readFile(log, "utf8").catch(() => "")).match(
    /ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/,
  )?.[0];
  if (!endpoint) await NodeTimersPromises.setTimeout(100);
}
if (!endpoint) throw new Error("T3 Space startup inspector did not become ready");
const preferences = JSON.parse(await NodeFSP.readFile(`${profile}/local-storage.json`, "utf8"));
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const response = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("T3 Space preference import timed out")),
    60_000,
  );
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    if (message.error || message.result?.exceptionDetails)
      reject(new Error("T3 Space rejected preference import"));
    else resolve(message.result);
  });
});
const expression = `(async () => {
  const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
  const {app, BrowserWindow} = electron;
  await app.whenReady();
  const waitWindow = async () => {
    const existing = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools:'));
    if (existing) return existing;
    return new Promise(resolve => app.once('browser-window-created', (_event, window) => resolve(window)));
  };
  const window = await waitWindow();
  if (window.webContents.isLoading() || !window.webContents.getURL())
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  await window.webContents.executeJavaScript(${JSON.stringify(`Object.entries(${JSON.stringify(preferences)}).forEach(([key, value]) => localStorage.setItem(key, value)); true`)});
  window.webContents.reload();
  setTimeout(() => process.getBuiltinModule('inspector').close(), 100);
  return true;
})()`;
socket.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }),
);
await response;
socket.close();
console.log(`Imported ${Object.keys(preferences).length} local preferences.`);
