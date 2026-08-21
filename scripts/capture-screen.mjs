/**
 * 디자인 검토용 화면 전체 캡처.
 *
 * 최신 production dist 를 격리 Chrome 프로필에서 열고, 출시 QA 하니스
 * (scripts/final-browser-qa.mjs)의 fixture·세션 시드를 그대로 재사용해 같은 데이터로
 * 렌더한 뒤 화면 전체 높이를 한 장으로 찍는다.
 *
 * QA 하니스는 뷰포트(390x844)만 찍기 때문에 스크롤이 긴 화면의 구성을 볼 수 없다.
 * 디자인 판정에는 화면 전체가 한 장으로 필요해서 이 도구를 따로 둔다.
 *
 * 운영 API·실결제·ADB 에는 접근하지 않는다(외부 호스트는 resolver 로 닫는다).
 *
 * 사용: npm run build && node scripts/capture-screen.mjs <out.png> [route] [free|premium]
 *   예: node scripts/capture-screen.mjs output/parent-home.png parent/home free
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mockApi, newDocumentScript } from "./final-browser-qa.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(ROOT_DIR, "dist");
const require = createRequire(import.meta.url);

const OUT_PATH = resolve(ROOT_DIR, process.argv[2] ?? "output/screen.png");
const ROUTE = process.argv[3] ?? "parent/home";
const TIER = process.argv[4] === "premium" ? "premium" : "free";
const SCENARIO = Object.freeze({ role: "parent", tier: TIER, catalogMode: "valid", overLimit: false });

const VIEWPORT = Object.freeze({ width: 390, height: 844, scale: 2 });
const MAX_CAPTURE_HEIGHT = 14_000;
const SERVER_PORT = 5217;
const CDP_PORT = 9337;

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const CORS_HEADERS = [
  { name: "access-control-allow-origin", value: "*" },
  { name: "access-control-allow-headers", value: "*" },
  { name: "access-control-allow-methods", value: "GET,POST,PATCH,PUT,DELETE,OPTIONS" },
];
/** 1×1 PNG — 비공개 사진 경로가 실제로 디코딩되는지 보기 위한 최소 바이트. */
const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const wait = (ms) => new Promise((settle) => setTimeout(settle, ms));
const jsonBody = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

async function resolveChromePath() {
  const candidates = process.platform === "win32"
    ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    if (await stat(candidate).catch(() => null)) return candidate;
  }
  throw new Error("Chrome 실행 파일을 찾지 못했습니다");
}

/** dist 정적 서버. 해시 라우팅이라 없는 경로는 index.html 로 넘긴다. */
function startDistServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let file = resolve(DIST_DIR, "." + decodeURIComponent(url.pathname));
      if (!file.startsWith(DIST_DIR)) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) file = resolve(DIST_DIR, "index.html");
      response.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((settle) => server.listen(SERVER_PORT, "127.0.0.1", () => settle(server)));
}

function createCdpClient(socket) {
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    send: (method, params = {}) => new Promise((settle) => {
      const id = ++nextId;
      pending.set(id, settle);
      socket.send(JSON.stringify({ id, method, params }));
    }),
    on: (listener) => listeners.push(listener),
  };
}

/** 외부 요청은 전부 fixture 로 닫는다 — 운영 API 에 절대 나가지 않는다. */
function installFixtureRouting(cdp) {
  cdp.on((message) => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request, resourceType } = message.params;
    void (async () => {
      try {
        const url = new URL(request.url);
        if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
          await cdp.send("Fetch.continueRequest", { requestId });
          return;
        }
        if (request.method === "OPTIONS") {
          await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 204, responseHeaders: CORS_HEADERS });
          return;
        }
        if (resourceType === "Script") {
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [...CORS_HEADERS, { name: "content-type", value: "application/javascript" }],
            body: Buffer.from("/* isolated capture */").toString("base64"),
          });
          return;
        }
        if (url.pathname.startsWith("/api/storage/child-photos/")) {
          await cdp.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [...CORS_HEADERS, { name: "content-type", value: "image/png" }],
            body: PIXEL_PNG_BASE64,
          });
          return;
        }
        await cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [...CORS_HEADERS, { name: "content-type", value: "application/json; charset=utf-8" }],
          body: jsonBody(mockApi(url.pathname, SCENARIO, request.method)),
        });
      } catch {
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => undefined);
      }
    })();
  });
}

export async function captureScreen() {
  if (!(await stat(resolve(DIST_DIR, "index.html")).catch(() => null))) {
    throw new Error("dist 가 없습니다. 먼저 npm run build 를 실행하세요");
  }

  const server = await startDistServer();
  const chrome = await resolveChromePath();
  const profileDir = await mkdtemp(resolve(tmpdir(), "hyeni-capture-"));
  const browser = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    // QA 하니스와 같은 이유로 언어를 고정한다 — CI 는 en-US 라 한국어 화면이 안 나온다.
    "--lang=ko-KR",
    "--accept-lang=ko-KR,ko",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  let socket = null;
  try {
    let target = null;
    for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
      await wait(300);
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json()).catch(() => []);
      target = targets.find((entry) => entry.type === "page") ?? null;
    }
    if (!target) throw new Error("CDP 대상을 찾지 못했습니다");

    // Windows 절대 경로는 file:// URL 이어야 ESM loader 가 받는다.
    const { default: WebSocket } = await import(pathToFileURL(require.resolve("ws")).href);
    socket = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((settle, fail) => {
      socket.once("open", settle);
      socket.once("error", fail);
    });

    const cdp = createCdpClient(socket);
    await cdp.send("Page.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    installFixtureRouting(cdp);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: newDocumentScript() });
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: VIEWPORT.scale, mobile: true });
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${SERVER_PORT}/index.html?qaRole=${SCENARIO.role}#/${ROUTE}`,
    });
    // BootSplash 게이트(1.6s)와 조회 완료를 지나야 실제 화면이 나온다.
    await wait(6_500);

    const targetAudit = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => [...document.querySelectorAll("button,a[href],input:not([type='hidden']),select,textarea,[role='button'],[role='tab'],summary")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
            && rect.width > 0 && rect.height > 0 && !element.matches(":disabled,[aria-disabled='true']")
            && !element.closest("[aria-hidden='true']");
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.getAttribute("class") || "",
            height: Math.round(rect.height * 10) / 10,
            label: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("name") || "").replace(/\\s+/g, " ").trim().slice(0, 80),
            tag: element.tagName.toLowerCase(),
            width: Math.round(rect.width * 10) / 10,
          };
        })
        .filter(({ width, height }) => width < 43.5 || height < 43.5))()`,
    });
    const smallTargets = targetAudit.result?.result?.value ?? [];

    // 스크롤러를 펼쳐 화면 전체를 한 장에 담는다.
    const measured = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const app = document.querySelector(".hy-app");
        const screen = document.querySelector(".hy-screen");
        const crashed = Boolean(document.querySelector(".hy-crash"));
        if (!app || !screen) return { height: null, crashed };
        const height = Math.ceil(screen.scrollHeight);
        app.style.height = height + "px";
        screen.style.overflow = "visible";
        return { height, crashed };
      })()`,
    });
    const { height, crashed } = measured.result?.result?.value ?? {};
    if (height) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: VIEWPORT.width,
        height: Math.min(height + 24, MAX_CAPTURE_HEIGHT),
        deviceScaleFactor: VIEWPORT.scale,
        mobile: true,
      });
      await wait(1_500);
    }

    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(OUT_PATH, Buffer.from(shot.result.data, "base64"));
    return { outPath: OUT_PATH, route: ROUTE, tier: TIER, height: height ?? null, crashed: Boolean(crashed), smallTargets };
  } finally {
    socket?.close();
    browser.kill();
    server.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    const result = await captureScreen();
    process.stdout.write(`캡처 완료: ${result.outPath}\n경로 ${result.route} · ${result.tier} · 높이 ${result.height ?? "미측정"}px${result.crashed ? " · ⚠️ 렌더 크래시" : ""}\n작은 조작 대상 ${JSON.stringify(result.smallTargets)}\n`);
    process.exit(result.crashed ? 1 : 0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
