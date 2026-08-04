/**
 * iPhone 홈 화면 PWA의 로컬 Service Worker 런타임 QA 하니스.
 *
 * production dist를 임시 디렉터리에 복사해 localhost로만 제공하고, 격리 Chrome에서
 * 설치·제어권·오프라인 재진입·autoUpdate 전환을 검증한다. 운영 API, 외부 네트워크,
 * 배포 도구와 Android 기기에는 접근하지 않는다.
 *
 * 사용: npm run qa:pwa-runtime
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareFreshQaOutputDir,
  resolveQaOutputDir,
} from "./lib/qaArtifactOutput.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(ROOT_DIR, "dist");
const DIST_INDEX = resolve(DIST_DIR, "index.html");
const DIST_SW = resolve(DIST_DIR, "sw.js");

export const PWA_RUNTIME_QA_OUTPUT_DIR = resolve(
  ROOT_DIR,
  "artifacts/release-evidence/pwa-runtime-qa",
);
export const PWA_RUNTIME_QA_ROUTE = "/app-update";
export const PWA_RUNTIME_QA_ROUTE_SELECTOR = ".au-root";
export const PWA_RUNTIME_QA_VIEWPORT = Object.freeze({ width: 390, height: 844 });
export const PWA_RUNTIME_QA_UPDATE_VERSION = "pwa-runtime-qa-v2";
export const PWA_RUNTIME_QA_OFFLINE_PROBE_PATH = "/__pwa-runtime-qa-offline-probe__.txt";

const QA_STATE_PREFIX = "__HYENI_PWA_RUNTIME_QA__:";
const QA_VERSION_MESSAGE = "HYENI_PWA_RUNTIME_QA_VERSION";
const DEFAULT_TIMEOUT_MS = 30_000;
const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
});

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export function isExpectedOfflineLoadingFailure(failure, origin) {
  if (
    failure?.phase !== "offline"
    || typeof failure?.error !== "string"
    || !/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(failure.error)
  ) return false;
  if ([
    `${origin}/index.html`,
    `${origin}/sw.js`,
    `${origin}${PWA_RUNTIME_QA_OFFLINE_PROBE_PATH}`,
  ].includes(failure.url)) return true;
  try {
    const url = new URL(failure.url);
    return url.origin === origin && /^\/fonts\/jua\/[^/]+\.woff2$/.test(url.pathname);
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function extractPwaEntryAssets(indexHtml) {
  return [...new Set(
    [...indexHtml.matchAll(/(?:src|href)="(?:\.\/|\/)([^"?#]+\.(?:js|css))(?:[?#][^"]*)?"/g)]
      .map((match) => match[1]),
  )];
}

export async function fingerprintDirectory(rootDir) {
  const files = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`dist에 일반 파일이 아닌 항목이 있습니다: ${relative(rootDir, filePath)}`);
      }
      const contents = await readFile(filePath);
      files.push({
        path: relative(rootDir, filePath).split(sep).join("/"),
        bytes: contents.length,
        sha256: sha256(contents),
      });
    }
  };
  await walk(rootDir);
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const manifest = files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`);
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    treeSha256: sha256(`${manifest.join("\n")}\n`),
    files,
  };
}

export function isAllowedQaRequest(rawUrl, origin) {
  try {
    const url = new URL(rawUrl);
    if (["data:", "blob:", "about:"].includes(url.protocol)) return true;
    return ["http:", "https:"].includes(url.protocol) && url.origin === origin;
  } catch {
    return false;
  }
}

function publicUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (["http:", "https:"].includes(url.protocol)) return `${url.origin}${url.pathname}`;
    return `${url.protocol}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

async function findChromeExecutable() {
  const directCandidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const playwrightRoot = resolve(homedir(), "AppData/Local/ms-playwright");
  const playwrightCandidates = [];
  try {
    const entries = await readdir(playwrightRoot, { withFileTypes: true });
    const chromiumEntries = entries
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
    for (const entry of chromiumEntries) {
      playwrightCandidates.push(resolve(playwrightRoot, entry.name, "chrome-win/chrome.exe"));
    }
  } catch {
    // Playwright 브라우저가 없어도 시스템 Chrome 후보를 계속 확인한다.
  }
  return [...directCandidates, ...playwrightCandidates]
    .find((candidate) => existsSync(candidate)) ?? null;
}

async function startDenyProxy() {
  const attempts = [];
  const server = createNetServer();
  server.on("connection", (connection) => {
    attempts.push({ at: new Date().toISOString() });
    connection.destroy();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("외부망 차단용 localhost 거부 프록시를 시작하지 못했습니다");
  }
  return { attempts, port: address.port, server };
}

function contentType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function safeFilePath(rootDir, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relativeName = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = resolve(rootDir, relativeName);
  const relation = relative(rootDir, target);
  if (!relation || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation))) {
    return target;
  }
  return null;
}

async function startStaticServer(rootDir) {
  const requests = [];
  let allowedHost = "";
  let origin = "";
  const server = createHttpServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      let requestPath = "/";
      let statusCode = 500;
      try {
        if (allowedHost && request.headers.host !== allowedHost) {
          statusCode = 403;
          response.writeHead(statusCode, { "cache-control": "no-store" });
          response.end();
          return;
        }
        if (method !== "GET" && method !== "HEAD") {
          statusCode = 405;
          response.writeHead(statusCode, {
            allow: "GET, HEAD",
            "cache-control": "no-store",
          });
          response.end();
          return;
        }
        const parsed = new URL(request.url ?? "/", origin || "http://127.0.0.1");
        requestPath = parsed.pathname;
        let filePath = safeFilePath(rootDir, requestPath);
        if (!filePath) {
          statusCode = 403;
          response.writeHead(statusCode, { "cache-control": "no-store" });
          response.end();
          return;
        }
        let fileStat;
        try {
          fileStat = await stat(filePath);
          if (fileStat.isDirectory()) {
            filePath = resolve(filePath, "index.html");
            fileStat = await stat(filePath);
          }
        } catch {
          statusCode = 404;
          response.writeHead(statusCode, { "cache-control": "no-store" });
          response.end();
          return;
        }
        if (!fileStat.isFile()) {
          statusCode = 404;
          response.writeHead(statusCode, { "cache-control": "no-store" });
          response.end();
          return;
        }

        statusCode = 200;
        const headers = {
          "cache-control": "no-store",
          "content-length": String(fileStat.size),
          "content-type": contentType(filePath),
          "x-content-type-options": "nosniff",
        };
        if (requestPath === "/sw.js") headers["service-worker-allowed"] = "/";
        response.writeHead(statusCode, headers);
        if (method === "HEAD") {
          response.end();
          return;
        }
        await new Promise((resolveStream, rejectStream) => {
          const stream = createReadStream(filePath);
          stream.once("error", rejectStream);
          response.once("finish", resolveStream);
          stream.pipe(response);
        });
      } catch {
        if (!response.headersSent) response.writeHead(500, { "cache-control": "no-store" });
        if (!response.writableEnded) response.end();
        statusCode = 500;
      } finally {
        requests.push({ method, path: requestPath, status: statusCode });
      }
    })();
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("PWA 검증용 localhost 서버를 시작하지 못했습니다");
  }
  allowedHost = `127.0.0.1:${address.port}`;
  origin = `http://${allowedHost}`;
  return { origin, requests, server };
}

async function closeHttpServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolveClose) => server.close(resolveClose));
  server.closeIdleConnections?.();
  await Promise.race([closed, wait(1_500)]);
  if (server.listening) server.closeAllConnections?.();
  await Promise.race([closed, wait(500)]);
}

async function closeNetServer(server) {
  if (!server?.listening) return;
  await Promise.race([
    new Promise((resolveClose) => server.close(resolveClose)),
    wait(1_000),
  ]);
}

async function waitForChildExit(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return true;
  const exited = new Promise((resolveExit) => processHandle.once("exit", () => resolveExit(true)));
  return Promise.race([exited, wait(timeoutMs).then(() => false)]);
}

async function stopProcessTree(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  if (process.platform === "win32" && processHandle.pid) {
    const taskkill = spawn(
      "C:/Windows/System32/taskkill.exe",
      ["/PID", String(processHandle.pid), "/T", "/F"],
      { env: {}, shell: false, stdio: "ignore", windowsHide: true },
    );
    await waitForChildExit(taskkill, 5_000);
  } else {
    processHandle.kill("SIGTERM");
  }
  if (await waitForChildExit(processHandle, 3_000)) return;
  processHandle.kill("SIGKILL");
  await waitForChildExit(processHandle, 1_000);
}

async function waitForDevToolsActivePort(profileRoot, processHandle, attempts = 200) {
  const activePortPath = resolve(profileRoot, "DevToolsActivePort");
  for (let index = 0; index < attempts; index += 1) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      throw new Error("격리 Chrome이 CDP 준비 전에 종료되었습니다");
    }
    try {
      const [portLine, browserSocketPath] = (await readFile(activePortPath, "utf8"))
        .trim()
        .split(/\r?\n/);
      const port = Number(portLine);
      if (
        Number.isInteger(port)
        && port > 0
        && port <= 65_535
        && browserSocketPath?.startsWith("/devtools/browser/")
      ) {
        return {
          port,
          browserWebSocketUrl: `ws://127.0.0.1:${port}${browserSocketPath}`,
        };
      }
    } catch {
      // 격리 프로필에 Chrome이 자동 포트를 기록할 때까지 짧게 재시도한다.
    }
    await wait(100);
  }
  throw new Error("격리 Chrome의 DevToolsActivePort 확인 시간 초과");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.handlers) handler(message);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP 연결이 종료되었습니다"));
      this.pending.clear();
    });
  }

  on(handler) {
    this.handlers.push(handler);
  }

  send(method, params = {}, timeoutMs = 20_000, sessionId = null) {
    const id = (this.nextId += 1);
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveSend(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectSend(error);
        },
      });
      this.socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }));
    });
  }

  async evaluate(expression, { awaitPromise = true, timeoutMs = 20_000 } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? "브라우저 평가 예외");
    }
    return result.result.value;
  }
}

async function waitForHttp(url, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 격리 Chrome CDP가 준비될 때까지 짧게 재시도한다.
    }
    await wait(200);
  }
  throw new Error(`로컬 CDP 준비 실패: ${url}`);
}

async function connectCdpSocket(webSocketUrl, label) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error(`${label} CDP WebSocket 연결 시간 초과`)), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolveOpen();
    }, { once: true });
    socket.addEventListener("error", (error) => {
      clearTimeout(timer);
      rejectOpen(error);
    }, { once: true });
  });
  return { socket, client: new CdpClient(socket) };
}

async function connectCdp(cdpPort) {
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("CDP page target을 찾지 못했습니다");
  return connectCdpSocket(page.webSocketDebuggerUrl, "page");
}

function instrumentationScript() {
  return `(() => {
    const prefix = ${JSON.stringify(QA_STATE_PREFIX)};
    let previous = null;
    try {
      previous = window.name.startsWith(prefix) ? JSON.parse(window.name.slice(prefix.length)) : null;
    } catch {}
    const state = {
      version: 1,
      documentLoads: Number(previous?.documentLoads || 0) + 1,
      controllerChanges: Number(previous?.controllerChanges || 0),
      lastLoadAt: Date.now(),
    };
    const persist = () => { window.name = prefix + JSON.stringify(state); };
    persist();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        state.controllerChanges += 1;
        state.lastControllerChangeAt = Date.now();
        persist();
      });
    }
  })();`;
}

async function readInstrumentationState(cdp) {
  return cdp.evaluate(`(() => {
    const prefix = ${JSON.stringify(QA_STATE_PREFIX)};
    if (!window.name.startsWith(prefix)) return null;
    try { return JSON.parse(window.name.slice(prefix.length)); } catch { return null; }
  })()`);
}

async function readRegistrationState(cdp) {
  return cdp.evaluate(`(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      supported: true,
      registered: Boolean(registration),
      scope: registration?.scope ?? null,
      activeState: registration?.active?.state ?? null,
      activeScript: registration?.active?.scriptURL ?? null,
      controlled: Boolean(navigator.serviceWorker.controller),
      controllerState: navigator.serviceWorker.controller?.state ?? null,
      controllerScript: navigator.serviceWorker.controller?.scriptURL ?? null,
    };
  })()`);
}

async function readRouteState(cdp) {
  return cdp.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(PWA_RUNTIME_QA_ROUTE_SELECTOR)});
    const rect = root?.getBoundingClientRect();
    const text = document.body?.innerText || "";
    return {
      hash: location.hash,
      title: document.title,
      navigatorOnlineAdvisory: navigator.onLine,
      rootVisible: Boolean(root && rect && rect.width > 0 && rect.height > 0),
      hasAppName: text.includes("혜니캘린더"),
      crash: Boolean(document.querySelector(".hy-crash, .route-error")),
      controlled: Boolean(navigator.serviceWorker?.controller),
    };
  })()`);
}

async function requestWorkerVersion(cdp) {
  return cdp.evaluate(`(() => new Promise((resolveVersion) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) { resolveVersion(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolveVersion(null), 3_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolveVersion(event.data?.version ?? null);
    };
    controller.postMessage({ type: ${JSON.stringify(QA_VERSION_MESSAGE)} }, [channel.port2]);
  }))()`, { timeoutMs: 5_000 });
}

async function setNetworkOfflineState(cdp, offline) {
  const conditions = {
    offline,
    latency: 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1,
    connectionType: offline ? "none" : "wifi",
  };
  await cdp.send("Network.emulateNetworkConditions", conditions);
  await cdp.send("Network.overrideNetworkState", conditions);
}

async function runOfflineNetworkProbe(cdp, origin) {
  const probeUrl = `${origin}${PWA_RUNTIME_QA_OFFLINE_PROBE_PATH}?run=${Date.now()}`;
  const result = await cdp.evaluate(`fetch(${JSON.stringify(probeUrl)}, {
    cache: "no-store",
    method: "GET",
  }).then((response) => ({ rejected: false, status: response.status })).catch((error) => ({
    rejected: true,
    errorName: error instanceof Error ? error.name : "unknown",
  }))`);
  return { url: publicUrl(probeUrl), ...result };
}

async function waitForCondition(label, reader, predicate, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  interrupted = () => false,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  let lastError = null;
  while (Date.now() < deadline) {
    if (interrupted()) throw new Error("PWA 런타임 QA가 사용자 신호로 중단되었습니다");
    try {
      lastValue = await reader();
      if (predicate(lastValue)) return lastValue;
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  const suffix = lastError instanceof Error
    ? lastError.message
    : JSON.stringify(lastValue);
  throw new Error(`${label} 확인 시간 초과: ${suffix}`);
}

async function updateServiceWorkerFixture(tempSwPath) {
  const source = await readFile(tempSwPath, "utf8");
  const marker = `\n;self.__HYENI_PWA_RUNTIME_QA_VERSION__=${JSON.stringify(PWA_RUNTIME_QA_UPDATE_VERSION)};\n`
    + `self.addEventListener("message",event=>{if(event.data?.type===${JSON.stringify(QA_VERSION_MESSAGE)}){event.ports[0]?.postMessage({type:${JSON.stringify(QA_VERSION_MESSAGE)},version:self.__HYENI_PWA_RUNTIME_QA_VERSION__});}});\n`;
  await writeFile(tempSwPath, `${source}${marker}`, "utf8");
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function installSignalHandlers(onSignal) {
  const handlers = new Map([
    ["SIGINT", () => onSignal("SIGINT")],
    ["SIGTERM", () => onSignal("SIGTERM")],
  ]);
  for (const [signal, handler] of handlers) process.once(signal, handler);
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

export function resolvePwaRuntimeQaOutputDir(args = process.argv.slice(2)) {
  return resolveQaOutputDir(args, {
    rootDir: ROOT_DIR,
    outputRoot: PWA_RUNTIME_QA_OUTPUT_DIR,
  });
}

export async function runPwaRuntimeQa({ outputDir = resolvePwaRuntimeQaOutputDir([]) } = {}) {
  if (!existsSync(DIST_INDEX) || !existsSync(DIST_SW)) {
    throw new Error("production dist의 index.html 또는 sw.js가 없습니다");
  }

  const freshOutputDir = await prepareFreshQaOutputDir(outputDir);
  const reportPath = resolve(freshOutputDir, "report.json");
  const report = {
    generatedAt: new Date().toISOString(),
    source: "local-exact-production-dist-pwa-runtime-isolated",
    buildFingerprint: null,
    operationalAccess: {
      externalNetwork: false,
      environmentConfiguration: false,
      secrets: false,
      deployment: false,
      androidDevices: false,
    },
    route: PWA_RUNTIME_QA_ROUTE,
    viewport: PWA_RUNTIME_QA_VIEWPORT,
    checks: { install: null, offlineReload: null, update: null, cleanup: null },
    console: [],
    network: {
      externalRequests: [],
      failures: [],
      expectedOfflineFailures: [],
      browserDenyProxy: null,
      workerTargets: [],
    },
    server: { requestCount: 0, httpErrors: [] },
    problems: [],
  };

  const tempRoot = await mkdtemp(resolve(tmpdir(), "hyeni-pwa-runtime-qa-"));
  const tempDist = resolve(tempRoot, "dist");
  const profileRoot = resolve(tempRoot, "chrome-profile");
  let staticServer = null;
  let denyProxy = null;
  let chrome = null;
  let socket = null;
  let browserSocket = null;
  let cleanupPromise = null;
  let interruptedSignal = null;
  let offlineEnabled = false;
  let cdp = null;
  let browserCdp = null;
  let phase = "setup";
  const consoleMessages = [];
  const externalRequests = [];
  const networkFailures = [];
  const expectedOfflineFailures = [];
  const requestUrls = new Map();
  const workerTargets = [];
  const appWorkerSessions = new Set();

  const cleanup = () => {
    cleanupPromise = (cleanupPromise ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try { socket?.close(); } catch { /* 종료 단계 소켓 오류는 무시한다. */ }
      try { browserSocket?.close(); } catch { /* 종료 단계 소켓 오류는 무시한다. */ }
      await stopProcessTree(chrome).catch(() => undefined);
      await closeHttpServer(staticServer?.server).catch(() => undefined);
      await closeNetServer(denyProxy?.server).catch(() => undefined);
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined);
    });
    return cleanupPromise;
  };
  const removeSignalHandlers = installSignalHandlers((signal) => {
    interruptedSignal = signal;
    void cleanup();
  });

  try {
    const sourceBeforeCopy = await fingerprintDirectory(DIST_DIR);
    await cp(DIST_DIR, tempDist, { recursive: true });
    const tempIndexPath = resolve(tempDist, "index.html");
    const tempSwPath = resolve(tempDist, "sw.js");
    const [sourceAfterCopy, snapshotFingerprint, indexBuffer, swBuffer] = await Promise.all([
      fingerprintDirectory(DIST_DIR),
      fingerprintDirectory(tempDist),
      readFile(tempIndexPath),
      readFile(tempSwPath),
    ]);
    const entryAssets = extractPwaEntryAssets(indexBuffer.toString("utf8"));
    const snapshotFiles = new Map(snapshotFingerprint.files.map((file) => [file.path, file]));
    const entryAssetFingerprints = entryAssets.map((path) => snapshotFiles.get(path) ?? { path, missing: true });
    const sourceStableDuringCopy = sourceBeforeCopy.treeSha256 === sourceAfterCopy.treeSha256;
    const snapshotMatchesSource = snapshotFingerprint.treeSha256 === sourceAfterCopy.treeSha256;
    report.buildFingerprint = {
      treeSha256: snapshotFingerprint.treeSha256,
      fileCount: snapshotFingerprint.fileCount,
      totalBytes: snapshotFingerprint.totalBytes,
      indexSha256: sha256(indexBuffer),
      serviceWorkerSha256: sha256(swBuffer),
      entryAssets,
      entryAssetFingerprints,
      sourceBeforeCopyTreeSha256: sourceBeforeCopy.treeSha256,
      sourceAfterCopyTreeSha256: sourceAfterCopy.treeSha256,
      sourceStableDuringCopy,
      snapshotMatchesSource,
    };
    if (!sourceStableDuringCopy || !snapshotMatchesSource || entryAssetFingerprints.some((file) => file.missing)) {
      throw new Error("production dist가 복사 중 변경됐거나 엔트리 자산이 누락되어 exact snapshot을 만들지 못했습니다");
    }
    staticServer = await startStaticServer(tempDist);
    const { origin } = staticServer;
    denyProxy = await startDenyProxy();
    const chromeExecutable = await findChromeExecutable();
    if (!chromeExecutable) throw new Error("로컬 Chrome 또는 Playwright Chromium을 찾지 못했습니다");
    chrome = spawn(chromeExecutable, [
      "--headless=new",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileRoot}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-pings",
      "--disable-gpu",
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      `--proxy-server=http://127.0.0.1:${denyProxy.port}`,
      "--proxy-bypass-list=127.0.0.1;localhost",
      `--window-size=${PWA_RUNTIME_QA_VIEWPORT.width},${PWA_RUNTIME_QA_VIEWPORT.height}`,
      "about:blank",
    ], { env: {}, shell: false, stdio: "ignore", windowsHide: true });

    const devToolsEndpoint = await waitForDevToolsActivePort(profileRoot, chrome);
    const browserConnected = await connectCdpSocket(devToolsEndpoint.browserWebSocketUrl, "browser");
    browserSocket = browserConnected.socket;
    browserCdp = browserConnected.client;
    const connected = await connectCdp(devToolsEndpoint.port);
    socket = connected.socket;
    cdp = connected.client;
    phase = "install";

    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: false });
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      ...PWA_RUNTIME_QA_VIEWPORT,
      screenWidth: PWA_RUNTIME_QA_VIEWPORT.width,
      screenHeight: PWA_RUNTIME_QA_VIEWPORT.height,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: instrumentationScript() });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

    const observeRuntimeMessage = (message) => {
      if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
        consoleMessages.push({
          phase,
          type: message.params.type,
          message: message.params.args
            .map((argument) => argument.description ?? String(argument.value ?? ""))
            .join(" ")
            .slice(0, 500),
        });
      }
      if (message.method === "Runtime.exceptionThrown") {
        consoleMessages.push({
          phase,
          type: "exception",
          message: (message.params.exceptionDetails?.exception?.description
            ?? message.params.exceptionDetails?.text
            ?? "runtime_exception").slice(0, 500),
        });
      }
    };
    const observeNetworkMessage = (message) => {
      if (message.method === "Network.requestWillBeSent") {
        requestUrls.set(`${message.sessionId ?? "page"}:${message.params.requestId}`, message.params.request.url);
        if (!isAllowedQaRequest(message.params.request.url, origin)) {
          externalRequests.push({
            phase,
            source: message.sessionId ? "app-worker" : "page",
            method: message.params.request.method,
            url: publicUrl(message.params.request.url),
          });
        }
      }
      if (["Network.webSocketCreated", "Network.webTransportCreated"].includes(message.method)) {
        const rawUrl = message.params.url ?? "";
        if (!isAllowedQaRequest(rawUrl, origin)) {
          externalRequests.push({
            phase,
            source: message.sessionId ? "app-worker" : "page",
            method: message.method === "Network.webSocketCreated" ? "WEBSOCKET" : "WEBTRANSPORT",
            url: publicUrl(rawUrl),
          });
        }
      }
      if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
        networkFailures.push({
          phase,
          status: message.params.response.status,
          url: publicUrl(message.params.response.url),
        });
      }
      if (message.method === "Network.loadingFailed" && !message.params.canceled && message.params.errorText !== "net::ERR_ABORTED") {
        const rawUrl = requestUrls.get(`${message.sessionId ?? "page"}:${message.params.requestId}`) ?? "";
        const failure = { phase, error: message.params.errorText, url: publicUrl(rawUrl) };
        const isExpectedOfflineNetworkFailure = isExpectedOfflineLoadingFailure(failure, origin);
        if (isExpectedOfflineNetworkFailure) expectedOfflineFailures.push(failure);
        else networkFailures.push(failure);
      }
    };

    cdp.on((message) => {
      observeRuntimeMessage(message);
      observeNetworkMessage(message);
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      void (async () => {
        if (!isAllowedQaRequest(request.url, origin)) {
          externalRequests.push({ phase, source: "page", method: request.method, url: publicUrl(request.url) });
          await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
          return;
        }
        await cdp.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
      })();
    });
    browserCdp.on((message) => {
      if (message.method === "Target.detachedFromTarget") {
        appWorkerSessions.delete(message.params.sessionId);
        return;
      }
      if (message.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo } = message.params;
        let appOwned = false;
        try {
          appOwned = new URL(targetInfo.url).origin === origin;
        } catch {
          appOwned = false;
        }
        workerTargets.push({ type: targetInfo.type, url: publicUrl(targetInfo.url), appOwned });
        if (appOwned) appWorkerSessions.add(sessionId);
        void (async () => {
          try {
            if (appOwned) await browserCdp.send("Network.enable", {}, 20_000, sessionId);
          } catch (error) {
            networkFailures.push({
              phase,
              error: `worker_target_network_observer: ${error instanceof Error ? error.message : String(error)}`,
              url: publicUrl(targetInfo.url),
            });
          } finally {
            await browserCdp.send("Runtime.runIfWaitingForDebugger", {}, 20_000, sessionId).catch((error) => {
              if (!appOwned) return;
              networkFailures.push({
                phase,
                error: `worker_target_resume: ${error instanceof Error ? error.message : String(error)}`,
                url: publicUrl(targetInfo.url),
              });
            });
          }
        })();
        return;
      }
      if (!message.sessionId || !appWorkerSessions.has(message.sessionId)) return;
      observeRuntimeMessage(message);
      observeNetworkMessage(message);
    });
    await browserCdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [
        { type: "service_worker", exclude: false },
        { type: "shared_worker", exclude: false },
        { type: "worker", exclude: false },
        { exclude: true },
      ],
    });

    const interrupted = () => interruptedSignal !== null;
    await cdp.send("Page.navigate", { url: `${origin}/index.html#${PWA_RUNTIME_QA_ROUTE}` });
    await waitForCondition(
      "온보딩 핵심 route",
      () => readRouteState(cdp),
      (state) => state?.hash === `#${PWA_RUNTIME_QA_ROUTE}`
        && state.rootVisible
        && state.hasAppName
        && !state.crash,
      { timeoutMs: 25_000, interrupted },
    );
    const installed = await waitForCondition(
      "Service Worker install/active/controller",
      () => readRegistrationState(cdp),
      (state) => state?.supported
        && state.registered
        && state.activeState === "activated"
        && state.controlled
        && state.controllerState === "activated",
      { timeoutMs: 45_000, interrupted },
    );
    const observedWorkerTargets = await waitForCondition(
      "Service Worker CDP target 관측",
      async () => [...workerTargets],
      (targets) => targets.some((target) => target.type === "service_worker" && target.appOwned),
      { timeoutMs: 10_000, interrupted },
    );
    report.checks.install = {
      ...installed,
      route: await readRouteState(cdp),
      serviceWorkerTargetObserved: observedWorkerTargets.some(
        (target) => target.type === "service_worker" && target.appOwned,
      ),
    };

    phase = "offline";
    const offlineServerRequestStart = staticServer.requests.length;
    await setNetworkOfflineState(cdp, true);
    offlineEnabled = true;
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForCondition(
      "Service Worker 오프라인 route 재진입",
      () => readRouteState(cdp),
      (state) => state?.hash === `#${PWA_RUNTIME_QA_ROUTE}`
        && state.rootVisible
        && state.hasAppName
        && !state.crash
        && state.controlled,
      { timeoutMs: 25_000, interrupted },
    );
    await setNetworkOfflineState(cdp, true);
    const offlineRoute = await waitForCondition(
      "오프라인 navigator 상태",
      () => readRouteState(cdp),
      (state) => state?.hash === `#${PWA_RUNTIME_QA_ROUTE}`
        && state.rootVisible
        && state.hasAppName
        && !state.crash
        && state.controlled
        && state.navigatorOnlineAdvisory === false,
      { timeoutMs: 10_000, interrupted },
    );
    const offlineNetworkProbe = await runOfflineNetworkProbe(cdp, origin);
    const offlineRegistration = await readRegistrationState(cdp);
    const offlineServerRequests = staticServer.requests.slice(offlineServerRequestStart);
    report.checks.offlineReload = {
      route: offlineRoute,
      registration: offlineRegistration,
      serverRequests: offlineServerRequests,
      networkEmulationOffline: true,
      navigatorOfflineConfirmed: offlineRoute.navigatorOnlineAdvisory === false,
      uncachedNetworkProbe: offlineNetworkProbe,
    };
    if (!offlineNetworkProbe.rejected) {
      throw new Error(`오프라인 uncached probe가 HTTP ${offlineNetworkProbe.status} 응답을 받았습니다`);
    }
    if (offlineServerRequests.length > 0) {
      throw new Error(`오프라인 reload가 localhost 서버에 ${offlineServerRequests.length}건 접근했습니다`);
    }

    await setNetworkOfflineState(cdp, false);
    offlineEnabled = false;
    await waitForCondition(
      "온라인 navigator 상태 복구",
      () => readRouteState(cdp),
      (state) => state?.navigatorOnlineAdvisory === true,
      { timeoutMs: 10_000, interrupted },
    );
    phase = "update";
    const beforeUpdateInstrumentation = await readInstrumentationState(cdp);
    if (!beforeUpdateInstrumentation) throw new Error("업데이트 전 document 계측 상태를 읽지 못했습니다");
    await updateServiceWorkerFixture(tempSwPath);
    const updatedSwBuffer = await readFile(tempSwPath);
    if (sha256(updatedSwBuffer) === report.buildFingerprint.serviceWorkerSha256) {
      throw new Error("임시 Service Worker 업데이트 바이트가 바뀌지 않았습니다");
    }

    await cdp.evaluate(`(() => {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (!registration) throw new Error("registration_missing");
        return registration.update();
      }).catch(() => undefined);
      return true;
    })()`, { awaitPromise: false });

    const updatedInstrumentation = await waitForCondition(
      "Service Worker controllerchange와 안전 업데이트 reload",
      () => readInstrumentationState(cdp),
      (state) => state
        && state.controllerChanges > beforeUpdateInstrumentation.controllerChanges
        && state.documentLoads > beforeUpdateInstrumentation.documentLoads,
      { timeoutMs: 35_000, interrupted },
    );
    const updatedRegistration = await waitForCondition(
      "업데이트 Service Worker 활성화",
      () => readRegistrationState(cdp),
      (state) => state?.activeState === "activated"
        && state.controlled
        && state.controllerState === "activated",
      { timeoutMs: 20_000, interrupted },
    );
    const controlledVersion = await requestWorkerVersion(cdp);
    const updatedRoute = await waitForCondition(
      "업데이트 뒤 핵심 route",
      () => readRouteState(cdp),
      (state) => state?.hash === `#${PWA_RUNTIME_QA_ROUTE}`
        && state.rootVisible
        && state.hasAppName
        && !state.crash
        && state.controlled,
      { timeoutMs: 20_000, interrupted },
    );
    report.checks.update = {
      serviceWorkerSha256: sha256(updatedSwBuffer),
      expectedVersion: PWA_RUNTIME_QA_UPDATE_VERSION,
      controlledVersion,
      before: beforeUpdateInstrumentation,
      after: updatedInstrumentation,
      registration: updatedRegistration,
      route: updatedRoute,
    };
    if (controlledVersion !== PWA_RUNTIME_QA_UPDATE_VERSION) {
      throw new Error("업데이트된 Service Worker가 현재 페이지 제어권을 얻지 못했습니다");
    }

  } catch (error) {
    report.problems.push({
      scope: interruptedSignal ? "interrupted" : "harness",
      message: error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800),
    });
  } finally {
    if (offlineEnabled && cdp) {
      await setNetworkOfflineState(cdp, false).catch(() => undefined);
    }
    removeSignalHandlers();
    await cleanup();
    report.console = uniqueRows(consoleMessages);
    report.network.externalRequests = uniqueRows(externalRequests);
    report.network.failures = uniqueRows(networkFailures);
    report.network.expectedOfflineFailures = uniqueRows(expectedOfflineFailures);
    report.network.browserDenyProxy = {
      enforced: Boolean(denyProxy),
      blockedConnectionCount: denyProxy?.attempts.length ?? 0,
      forwardedConnectionCount: 0,
    };
    report.network.workerTargets = uniqueRows(workerTargets);
    report.server.requestCount = staticServer?.requests.length ?? 0;
    report.server.httpErrors = staticServer?.requests.filter((request) => request.status >= 400) ?? [];
    if (report.console.length > 0) report.problems.push({ scope: "console", count: report.console.length });
    if (report.network.externalRequests.length > 0) {
      report.problems.push({ scope: "external-network-attempt", count: report.network.externalRequests.length });
    }
    if (report.network.failures.length > 0) {
      report.problems.push({ scope: "network", count: report.network.failures.length });
    }
    if (report.server.httpErrors.length > 0) {
      report.problems.push({ scope: "localhost-http", count: report.server.httpErrors.length });
    }
    report.checks.cleanup = {
      browserProcessExited: !chrome || chrome.exitCode !== null || chrome.signalCode !== null,
      denyProxyClosed: !denyProxy?.server.listening,
      localhostServerClosed: !staticServer?.server.listening,
      temporaryDistRemoved: !existsSync(tempDist),
      temporaryProfileRemoved: !existsSync(profileRoot),
    };
    if (Object.values(report.checks.cleanup).some((value) => value !== true)) {
      report.problems.push({ scope: "cleanup", ...report.checks.cleanup });
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (report.problems.length > 0) {
    const error = new Error(`PWA 런타임 QA 실패 ${report.problems.length}건 — ${reportPath}`);
    if (interruptedSignal) error.code = "QA_INTERRUPTED";
    throw error;
  }
  return { reportPath, report };
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    const outputDir = resolvePwaRuntimeQaOutputDir();
    const { reportPath } = await runPwaRuntimeQa({ outputDir });
    process.stdout.write(`PWA 런타임 QA 완료: install·offline·안전 업데이트 문제 0건\n${reportPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error?.code === "QA_INTERRUPTED" ? 130 : 1;
  }
}
