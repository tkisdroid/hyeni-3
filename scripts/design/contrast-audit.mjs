// Runtime contrast audit: for every rendered text element inside .ph-page,
// take its computed color and the *modal* pixel colour inside its own box
// (the background dominates the histogram) and compute the real ratio.
// This is the only honest check for translucent glass — token math can't see
// what the backdrop composited to, and a blind token sweep flags colours that
// are never actually painted on that surface.
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { WebSocket } from "ws";

const URL_ = "http://127.0.0.1:5199/scripts/design/preview-parent-home.html";
const SCROLLS = (process.argv[2] ?? "0,400,800,1200,1600,2000,2400").split(",").map(Number);

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const profile = mkdtempSync(join(tmpdir(), "hyeni-a-"));
const port = 9700 + Math.floor(Math.random() * 200);
const child = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--force-device-scale-factor=2",
  "--lang=ko-KR", "--accept-lang=ko-KR,ko", "about:blank"], { stdio: "ignore" });

let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await delay(200);
}
const sock = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
sock.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => sock.on("open", r));
const send = (m, p = {}) => { const i = ++id; sock.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((r) => pending.set(i, r)); };

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: URL_ });
await delay(2200);

const COLLECT = `JSON.stringify([...document.querySelectorAll('.ph-page *, .hy-tabbar *')].filter(el => {
  const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length);
  if (!t) return false;
  const r = el.getBoundingClientRect();
  return r.width > 6 && r.height > 6 && r.top > -5 && r.bottom < 860;
}).map(el => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    tag: (el.className || el.tagName).toString().split(' ')[0],
    text: el.textContent.trim().slice(0, 12),
    color: cs.color,
    bgc: cs.backgroundColor,
    size: parseFloat(cs.fontSize),
    weight: parseInt(cs.fontWeight, 10) || 400,
    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
  };
}))`;

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

const fails = [];
let checked = 0;
for (const s of SCROLLS) {
  await send("Runtime.evaluate", { expression: `document.querySelector('.hy-screen').scrollTop=${s}` });
  await delay(420);
  const els = JSON.parse((await send("Runtime.evaluate", { expression: COLLECT, returnByValue: true })).result.result.value);
  const png = Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64");
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const ch = raw.length / (width * height);

  for (const e of els) {
    const hist = new Map();
    const x0 = Math.max(0, e.x * 2), y0 = Math.max(0, e.y * 2);
    const x1 = Math.min(width - 1, (e.x + e.w) * 2), y1 = Math.min(height - 1, (e.y + e.h) * 2);
    if (x1 <= x0 || y1 <= y0) continue;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * ch;
      // quantise to 8 levels so anti-aliasing noise collapses into the bg bucket
      const k = ((raw[i] >> 3) << 16) | ((raw[i + 1] >> 3) << 8) | (raw[i + 2] >> 3);
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    // ⚠️ 순수 최빈값을 쓰면 굵고 꽉 찬 제목에서 '글자색'이 배경으로 뽑힌다(1.00:1 허위 실패).
    // 상위 6개 버킷 중 가장 밝은 것을 배경으로 본다 — 이 화면은 항상 어두운 글자/밝은 배경이다.
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k]) => [((k >> 16) & 31) << 3 | 4, ((k >> 8) & 31) << 3 | 4, (k & 31) << 3 | 4]);
    let bg = top.sort((a, b) => lum(b) - lum(a))[0];
    // 자기 배경이 불투명하면 그게 정답이다 — 흰 글자/빨간 알약(배지)에서 밝은쪽 규칙이 뒤집힌다.
    const ownBg = e.bgc.match(new RegExp(String.raw`[0-9.]+`,"g"))?.map(Number);
    if (ownBg && (ownBg.length < 4 || ownBg[3] >= 0.98)) bg = ownBg.slice(0, 3);
    const m = e.color.match(/\d+/g).map(Number);
    const c = ratio(m.slice(0, 3), bg);
    // WCAG large-text relaxation: >=18.66px bold or >=24px
    const large = e.size >= 24 || (e.size >= 18.66 && e.weight >= 700);
    const need = large ? 3 : 4.5;
    checked++;
    if (c < need) fails.push({ s, ...e, bg: "#" + bg.map((v) => v.toString(16).padStart(2, "0")).join(""), c: c.toFixed(2), need });
  }
}

console.log(`checked ${checked} text elements across scrolls ${SCROLLS.join(",")}`);
if (!fails.length) console.log("ALL PASS (WCAG AA)");
else {
  const seen = new Set();
  for (const f of fails) {
    const key = f.tag + f.text;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`FAIL ${f.c}/${f.need}  ${f.tag.padEnd(24)} "${f.text}" color=${f.color} bg=${f.bg} ${f.size}px/${f.weight}`);
  }
}
sock.close(); child.kill(); process.exit(0);
