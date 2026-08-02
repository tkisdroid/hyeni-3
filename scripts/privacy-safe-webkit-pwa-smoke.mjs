/**
 * 현재 dist 전용 개인정보 비접근 iPhone급 WebKit PWA smoke.
 *
 * 앱/Worker 환경변수, 브라우저 저장소, cookie, 세션 파일을 읽지 않는다.
 * 외부 네트워크는 Playwright route와 연결 거부 프록시로 이중 차단한다.
 * 사용: node scripts/privacy-safe-webkit-pwa-smoke.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(ROOT_DIR, "dist");
// @playwright/test는 이 저장소 자체 devDependency만 사용한다(과거 hyeni-1 차용 폐지).
const PLAYWRIGHT_ROOT = resolve(ROOT_DIR, "node_modules", "@playwright", "test").replaceAll("\\", "/");
const requireLocal = createRequire(import.meta.url);
const playwrightPackagePath = requireLocal.resolve("@playwright/test/package.json");
assert.ok(
  playwrightPackagePath.replaceAll("\\", "/").startsWith(PLAYWRIGHT_ROOT),
  `이 저장소의 @playwright/test가 아닙니다: ${playwrightPackagePath}`,
);
const { devices, webkit } = requireLocal("@playwright/test");

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const closeServer = (server) => new Promise((resolveClose) => server.close(resolveClose));

function safeDistPath(pathname) {
  const relativeName = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const target = resolve(DIST_DIR, relativeName);
  const relation = relative(DIST_DIR, target);
  if (relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..")) return target;
  return null;
}

async function startStaticServer() {
  const requests = [];
  const server = createHttpServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      let pathname = "/";
      let statusCode = 500;
      try {
        if (method !== "GET" && method !== "HEAD") {
          statusCode = 405;
          response.writeHead(statusCode, { allow: "GET, HEAD", "cache-control": "no-store" });
          response.end();
          return;
        }
        pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        const filePath = safeDistPath(pathname);
        if (!filePath) {
          statusCode = 403;
          response.writeHead(statusCode, { "cache-control": "no-store" });
          response.end();
          return;
        }
        let fileStat;
        try {
          fileStat = await stat(filePath);
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
          "content-type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
        };
        if (pathname === "/sw.js") headers["service-worker-allowed"] = "/";
        response.writeHead(statusCode, headers);
        if (method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(filePath).pipe(response);
      } catch {
        if (!response.headersSent) response.writeHead(500, { "cache-control": "no-store" });
        if (!response.writableEnded) response.end();
      } finally {
        requests.push({ method, pathname, statusCode });
      }
    })();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string", "localhost 서버 주소를 얻지 못했습니다");
  return { origin: `http://127.0.0.1:${address.port}`, requests, server };
}

async function startDenyProxy() {
  let blockedConnections = 0;
  const server = createNetServer((socket) => {
    blockedConnections += 1;
    socket.destroy();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string", "외부망 차단 프록시 주소를 얻지 못했습니다");
  return { get blockedConnections() { return blockedConnections; }, port: address.port, server };
}

async function staticChecks() {
  const [indexHtml, manifestRaw, swBytes, assetNames] = await Promise.all([
    readFile(resolve(DIST_DIR, "index.html"), "utf8"),
    readFile(resolve(DIST_DIR, "manifest.webmanifest"), "utf8"),
    readFile(resolve(DIST_DIR, "sw.js")),
    readdir(resolve(DIST_DIR, "assets")),
  ]);
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.name, "혜니캘린더");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.orientation, "portrait");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
  await Promise.all(manifest.icons.map(async (icon) => {
    assert.equal(typeof icon.src, "string");
    assert.ok((await stat(resolve(DIST_DIR, icon.src))).isFile(), `manifest 아이콘 없음: ${icon.src}`);
  }));

  const entryAssets = [...indexHtml.matchAll(/(?:src|href)="\.\/([^"?#]+\.(?:js|css))"/g)]
    .map((match) => match[1]);
  assert.ok(entryAssets.length >= 2, "index JS/CSS entry를 찾지 못했습니다");
  await Promise.all(entryAssets.map(async (assetPath) => {
    assert.ok((await stat(resolve(DIST_DIR, assetPath))).isFile(), `entry asset 없음: ${assetPath}`);
  }));

  const jsAssetNames = assetNames.filter((name) => name.endsWith(".js"));
  const jsContents = await Promise.all(jsAssetNames.map(async (name) => ({
    name,
    source: await readFile(resolve(DIST_DIR, "assets", name), "utf8"),
  })));
  const subscriptionAsset = jsContents.find(({ source }) => (
    source.includes("프리미엄 연간 구독")
    && source.includes("프리미엄 월간 구독")
  ));
  assert.ok(subscriptionAsset, "Free/Premium 구독 lazy chunk를 찾지 못했습니다");
  for (const expectedCopy of [
    "현재 상품은 무료 플랜으로 표시돼요.",
    "SOS와 긴급 안전 알림은 무료로 계속 제공돼요.",
    "프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능을 열어드려요.",
    "월 4,900원·연 39,000원",
  ]) {
    assert.ok(subscriptionAsset.source.includes(expectedCopy), `구독 계약 문구 없음: ${expectedCopy}`);
  }

  return {
    entryAssets,
    indexSha256: sha256(indexHtml),
    manifestSha256: sha256(manifestRaw),
    serviceWorkerBytes: swBytes.length,
    serviceWorkerSha256: sha256(swBytes),
    subscriptionAsset: `assets/${subscriptionAsset.name}`,
  };
}

async function runtimeChecks(origin, requests, denyProxy) {
  const externalAttempts = [];
  const consoleProblems = [];
  const pageErrors = [];
  const iphone13 = devices["iPhone 13"];
  assert.ok(iphone13, "Playwright iPhone 13 device profile이 없습니다");
  const browser = await webkit.launch({
    env: { SYSTEMROOT: "C:\\Windows", WINDIR: "C:\\Windows" },
    proxy: {
      server: `http://127.0.0.1:${denyProxy.port}`,
      bypass: "127.0.0.1,localhost",
    },
  });
  const context = await browser.newContext({
    ...iphone13,
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    serviceWorkers: "allow",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ([origin, "data:", "blob:", "about:"].includes(url.origin) || ["data:", "blob:", "about:"].includes(url.protocol)) {
      await route.continue();
      return;
    }
    externalAttempts.push(`${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleProblems.push({ type: message.type(), text: message.text().slice(0, 500) });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));

  try {
    await page.goto(`${origin}/index.html#/onboarding`, { waitUntil: "domcontentloaded" });
    await page.locator(".ob-root").waitFor({ state: "visible" });
    await assert.doesNotReject(() => page.getByText("혜니캘린더", { exact: true }).first().waitFor());
    await assert.doesNotReject(() => page.getByText("함께 보는 우리 가족 일정", { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole("button", { name: /학부모/ }).waitFor());
    await assert.doesNotReject(() => page.getByRole("button", { name: /아이/ }).waitFor());

    const onlineLayout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      hasTouch: "ontouchstart" in globalThis,
      scrollWidth: document.documentElement.scrollWidth,
      viewportHeight: globalThis.innerHeight,
      viewportWidth: globalThis.innerWidth,
    }));
    assert.equal(onlineLayout.viewportWidth, 390);
    assert.equal(onlineLayout.viewportHeight, 844);
    assert.equal(onlineLayout.hasTouch, true);
    assert.ok(onlineLayout.scrollWidth <= onlineLayout.clientWidth, `온보딩 가로 overflow ${onlineLayout.scrollWidth - onlineLayout.clientWidth}px`);

    await page.goto(`${origin}/index.html#/subscription`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/#\/onboarding$/);
    await page.locator(".ob-root").waitFor({ state: "visible" });
    const guestSubscriptionRedirect = new URL(page.url()).hash;

    const serviceWorkerSupported = await page.evaluate(() => "serviceWorker" in navigator);
    assert.equal(serviceWorkerSupported, true, "WebKit에서 Service Worker를 지원하지 않습니다");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const initiallyControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!initiallyControlled) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".ob-root").waitFor({ state: "visible" });
    }
    await page.waitForFunction(async () => {
      const ready = await navigator.serviceWorker.ready;
      return ready.active?.state === "activated" && Boolean(navigator.serviceWorker.controller);
    });
    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return {
        active: ready.active?.state ?? null,
        controlled: Boolean(navigator.serviceWorker.controller),
        scopePath: new URL(ready.scope).pathname,
        supported: true,
      };
    });
    assert.deepEqual(registration, { active: "activated", controlled: true, scopePath: "/", supported: true });
    await page.locator(".ob-root").waitFor({ state: "visible" });

    const requestCountBeforeOffline = requests.length;
    await context.setOffline(true);
    const offlineLayout = await page.evaluate(async () => {
      const shellResponse = await caches.match("/index.html", { ignoreSearch: true });
      if (!shellResponse) throw new Error("offline_shell_cache_miss");
      const shellHtml = await shellResponse.text();
      return {
        cachedShellHasRoot: shellHtml.includes('<div id="root"'),
        cachedShellStatus: shellResponse.status,
        clientWidth: document.documentElement.clientWidth,
        controlled: Boolean(navigator.serviceWorker.controller),
        online: navigator.onLine,
        scrollWidth: document.documentElement.scrollWidth,
        titleVisible: [...document.querySelectorAll(".ob-role-title")]
          .some((element) => element.textContent?.trim() === "혜니캘린더"),
      };
    });
    assert.equal(offlineLayout.online, false);
    assert.equal(offlineLayout.controlled, true);
    assert.equal(offlineLayout.titleVisible, true);
    assert.equal(offlineLayout.cachedShellStatus, 200);
    assert.equal(offlineLayout.cachedShellHasRoot, true);
    assert.ok(offlineLayout.scrollWidth <= offlineLayout.clientWidth, "오프라인 온보딩에 가로 overflow가 있습니다");
    assert.equal(requests.length, requestCountBeforeOffline, "오프라인 Cache Storage 조회가 localhost 서버에 접근했습니다");
    const screenshot = await page.screenshot({ animations: "disabled", fullPage: true });
    await context.setOffline(false);

    assert.deepEqual(pageErrors, [], `page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(consoleProblems, [], `console problems: ${JSON.stringify(consoleProblems)}`);
    assert.deepEqual(externalAttempts, [], `외부 요청 시도: ${JSON.stringify(externalAttempts)}`);
    assert.equal(denyProxy.blockedConnections, 0, "외부망 차단 프록시에 연결 시도가 있었습니다");
    return {
      consoleProblems,
      externalAttempts,
      guestSubscriptionRedirect,
      offlineNavigation: "not verified: Playwright WebKit offline reload returned an internal engine error; Cache Storage shell verified instead",
      offlineLayout,
      onlineLayout,
      pageErrors,
      playwrightPackagePath: playwrightPackagePath.replaceAll("\\", "/"),
      registration,
      screenshotBytes: screenshot.length,
      screenshotSha256: sha256(screenshot),
    };
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await context.close();
    await browser.close();
  }
}

let staticServer;
let denyProxy;
try {
  const staticResult = await staticChecks();
  staticServer = await startStaticServer();
  denyProxy = await startDenyProxy();
  const runtimeResult = await runtimeChecks(staticServer.origin, staticServer.requests, denyProxy);
  const [indexAfter, serviceWorkerAfter] = await Promise.all([
    readFile(resolve(DIST_DIR, "index.html")),
    readFile(resolve(DIST_DIR, "sw.js")),
  ]);
  assert.equal(sha256(indexAfter), staticResult.indexSha256, "검증 중 dist/index.html이 변경됐습니다");
  assert.equal(sha256(serviceWorkerAfter), staticResult.serviceWorkerSha256, "검증 중 dist/sw.js가 변경됐습니다");
  const httpErrors = staticServer.requests.filter(({ statusCode }) => statusCode >= 400);
  assert.deepEqual(httpErrors, [], `localhost HTTP 오류: ${JSON.stringify(httpErrors)}`);
  process.stdout.write(`${JSON.stringify({
    result: "PASS",
    scope: "current exact dist; isolated mobile WebKit; no real iPhone",
    static: staticResult,
    runtime: runtimeResult,
    server: {
      blockedExternalConnections: denyProxy.blockedConnections,
      httpErrors,
      requestCount: staticServer.requests.length,
    },
  }, null, 2)}\n`);
} finally {
  if (denyProxy?.server.listening) await closeServer(denyProxy.server);
  if (staticServer?.server.listening) await closeServer(staticServer.server);
}
