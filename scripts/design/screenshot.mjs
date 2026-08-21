// CDP screenshot of the preview harness at mobile metrics.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const URL_ = process.argv[2] ?? "http://127.0.0.1:5199/preview-parent-home.html";
const OUT = process.argv[3] ?? "shot.png";
const SCROLL = Number(process.argv[4] ?? 0);
const HEIGHT = Number(process.argv[5] ?? 844);

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
].find((p) => {
  try { return existsSync(p); } catch { return false; }
});
if (!CHROME) { console.error("chrome not found"); process.exit(1); }

const profile = mkdtempSync(join(tmpdir(), "hyeni-shot-"));
const port = 9333 + Math.floor(Math.random() * 200);
const child = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--force-device-scale-factor=2",
  "--lang=ko-KR",
  "--accept-lang=ko-KR,ko",
  "about:blank",
], { stdio: "ignore" });

async function cdpTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(250);
  }
  throw new Error("no target");
}


const wsUrl = await cdpTarget();

// minimal CDP client over WebSocket
const { WebSocket } = await import("ws").catch(() => ({ WebSocket: globalThis.WebSocket }));
const sock = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
sock.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
await new Promise((res) => sock.addEventListener("open", res));
function send(method, params = {}) {
  const mid = ++id;
  sock.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res) => pending.set(mid, res));
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: HEIGHT, deviceScaleFactor: 2, mobile: true,
});
await send("Page.navigate", { url: URL_ });
await delay(2200);
if (SCROLL) {
  await send("Runtime.evaluate", { expression: `document.querySelector('.hy-screen').scrollTop = ${SCROLL}` });
  await delay(600);
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(OUT, Buffer.from(shot.result.data, "base64"));
console.log("saved", OUT);
sock.close();
child.kill();
process.exit(0);
