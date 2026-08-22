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
        let resolvedFilePath = filePath;
        let fileStat;
        try {
          fileStat = await stat(resolvedFilePath);
        } catch {
          // Cloudflare Pages가 /oauth/callback.html을 확장자 없는
          // /oauth/callback으로 제공하는 production 동작을 로컬에서도 재현한다.
          if (!extname(resolvedFilePath)) {
            resolvedFilePath = `${resolvedFilePath}.html`;
            try {
              fileStat = await stat(resolvedFilePath);
            } catch {
              fileStat = undefined;
            }
          }
          if (!fileStat) {
            statusCode = 404;
            response.writeHead(statusCode, { "cache-control": "no-store" });
            response.end();
            return;
          }
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
          "content-type": MIME_TYPES[extname(resolvedFilePath).toLowerCase()] ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
        };
        if (pathname === "/sw.js") headers["service-worker-allowed"] = "/";
        response.writeHead(statusCode, headers);
        if (method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(resolvedFilePath).pipe(response);
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
  const [indexHtml, callbackHtml, manifestRaw, swBytes, assetNames] = await Promise.all([
    readFile(resolve(DIST_DIR, "index.html"), "utf8"),
    readFile(resolve(DIST_DIR, "oauth", "callback.html"), "utf8"),
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
  const callbackEntryAssets = [...callbackHtml.matchAll(/(?:src|href)="\/([^"?#]+\.(?:js|css))"/g)]
    .map((match) => match[1]);
  assert.deepEqual(callbackEntryAssets, entryAssets, "OAuth 콜백이 현재 index와 다른 JS/CSS를 참조합니다");
  assert.doesNotMatch(callbackHtml, /(?:src|href)="\.\//, "OAuth 콜백에 깨지는 중첩 상대 자원 경로가 있습니다");
  assert.match(callbackHtml, /<base href="\/" \/>/, "OAuth 콜백의 Service Worker 기준 경로가 루트가 아닙니다");

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
    "웹에서는 Google Play 결제·복원을 쓸 수 없어요.",
  ]) {
    assert.ok(subscriptionAsset.source.includes(expectedCopy), `구독 계약 문구 없음: ${expectedCopy}`);
  }

  return {
    entryAssets,
    callbackSha256: sha256(callbackHtml),
    indexSha256: sha256(indexHtml),
    manifestSha256: sha256(manifestRaw),
    serviceWorkerBytes: swBytes.length,
    serviceWorkerSha256: sha256(swBytes),
    subscriptionAsset: `assets/${subscriptionAsset.name}`,
  };
}

async function runtimeChecks(origin, requests, denyProxy) {
  const externalAttempts = [];
  let authRequests = [];
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
  await context.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__hyWebkitAuthRequests = [];
    window.__hyWebkitAnonymousRequests = 0;
    window.fetch = (input, init) => {
      const rawUrl = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(rawUrl, location.href);
      if (url.pathname === "/api/access-region") {
        return Promise.resolve(new Response(JSON.stringify({ country: "KR" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
        }));
      }
      if (url.pathname === "/auth/anonymous") {
        window.__hyWebkitAnonymousRequests += 1;
        return Promise.resolve(new Response(JSON.stringify({ error: "unexpected_anonymous_login" }), {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        }));
      }
      if (["/auth/login-password", "/auth/check-login-id"].includes(url.pathname)) {
        const wrongPassword = url.pathname === "/auth/login-password";
        window.__hyWebkitAuthRequests.push({
          method: String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
          pathname: url.pathname,
          status: wrongPassword ? 401 : 200,
        });
        return Promise.resolve(new Response(JSON.stringify(wrongPassword
          ? { error: "invalid_credentials" }
          : { available: true }), {
          status: wrongPassword ? 401 : 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        }));
      }
      return nativeFetch(input, init);
    };
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
    const callbackResponse = await page.goto(`${origin}/oauth/callback`, { waitUntil: "domcontentloaded" });
    assert.equal(callbackResponse?.status(), 200, "WebKit OAuth 콜백 물리 엔트리가 200이 아닙니다");
    assert.equal(new URL(page.url()).pathname, "/oauth/callback");
    await page.locator("#root").waitFor({ state: "attached" });
    const callbackEntryLoaded = await page.evaluate(() => (
      [...document.scripts].some((script) => /\/assets\/index-[^/]+\.js$/.test(script.src))
    ));
    assert.equal(callbackEntryLoaded, true, "WebKit OAuth 콜백이 production 진입 번들을 로드하지 못했습니다");
    await page.waitForFunction(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some((registration) => (
        new URL(registration.scope).pathname === "/" && registration.active?.state === "activated"
      ));
    }, undefined, { timeout: 15_000 });
    const callbackServiceWorkerScope = await page.evaluate(async () => (
      (await navigator.serviceWorker.getRegistrations()).map((registration) => new URL(registration.scope).pathname)
    ));
    assert.ok(callbackServiceWorkerScope.includes("/"), "OAuth 콜백이 루트 Service Worker를 등록하지 못했습니다");

    await page.goto(`${origin}/index.html#/onboarding`, { waitUntil: "domcontentloaded" });
    await page.locator(".ob-root").waitFor({ state: "visible" });
    await assert.doesNotReject(() => page.getByText("혜니캘린더", { exact: true }).first().waitFor());
    await assert.doesNotReject(() => page.getByText("함께 보는 우리 가족 일정", { exact: true }).waitFor());
    await assert.doesNotReject(() => page.getByRole("button", { name: /학부모/ }).waitFor());
    await assert.doesNotReject(() => page.getByRole("button", { name: /아이/ }).waitFor());

    const onlineLayout = await page.evaluate(() => ({
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      clientWidth: document.documentElement.clientWidth,
      hasTouch: "ontouchstart" in globalThis,
      htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
      rootOverflowX: getComputedStyle(document.querySelector("#root")).overflowX,
      rolePaddingTop: Number.parseFloat(getComputedStyle(document.querySelector(".ob-role")).paddingTop),
      rolePaddingLeft: Number.parseFloat(getComputedStyle(document.querySelector(".ob-role")).paddingLeft),
      languageCurrent: document.querySelector(".hy-language__current")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      languageExpanded: document.querySelector(".hy-language__current")?.getAttribute("aria-expanded") ?? null,
      languageOptionsVisible: (() => {
        const collapse = document.querySelector(".hy-language__collapse");
        return collapse?.getAttribute("aria-hidden") !== "true"
          && getComputedStyle(collapse).visibility !== "hidden";
      })(),
      scrollWidth: document.documentElement.scrollWidth,
      viewportHeight: globalThis.innerHeight,
      viewportWidth: globalThis.innerWidth,
    }));
    assert.equal(onlineLayout.viewportWidth, 390);
    assert.equal(onlineLayout.viewportHeight, 844);
    assert.equal(onlineLayout.hasTouch, true);
    assert.ok(onlineLayout.scrollWidth <= onlineLayout.clientWidth, `온보딩 가로 overflow ${onlineLayout.scrollWidth - onlineLayout.clientWidth}px`);
    assert.equal(onlineLayout.htmlOverflowX, "hidden", "Safari 문서 루트의 가로 끌림이 잠기지 않았습니다");
    assert.equal(onlineLayout.bodyOverflowX, "hidden", "Safari body의 가로 끌림이 잠기지 않았습니다");
    assert.equal(onlineLayout.rootOverflowX, "hidden", "앱 root의 가로 끌림이 잠기지 않았습니다");
    assert.ok(
      onlineLayout.rolePaddingTop <= 32,
      `Safari 탭에서 역할 화면 위 여백이 과도합니다: ${onlineLayout.rolePaddingTop}px`,
    );
    assert.equal(onlineLayout.rolePaddingLeft, 24, "첫 역할 화면의 좌우 리듬이 달라졌습니다");
    assert.ok(onlineLayout.languageCurrent?.includes("한국어"), "접속 국가 기본 언어가 하단에 보이지 않습니다");
    assert.equal(onlineLayout.languageExpanded, "false");
    assert.equal(onlineLayout.languageOptionsVisible, false);
    await page.locator(".hy-language__current").click();
    assert.equal(await page.locator(".hy-language__options .hy-language__option").count(), 9);
    assert.equal(await page.locator(".hy-language__current").getAttribute("aria-expanded"), "true");
    await page.locator(".hy-language__current").click();

    // 아이관리 공용 QR을 iPhone Safari가 새 탭에서 직접 연 경우 역할을 아이로 단정하지 않는다.
    const roleChoicePage = await context.newPage();
    roleChoicePage.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleProblems.push({ type: message.type(), text: message.text().slice(0, 500) });
      }
    });
    roleChoicePage.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 500)));
    await roleChoicePage.goto(`${origin}/index.html#/onboarding?pair=KID-QA123456`, { waitUntil: "domcontentloaded" });
    await roleChoicePage.locator(".ob-invite-context").waitFor({ state: "visible" });
    const roleChoiceInvite = await roleChoicePage.evaluate(() => ({
      anonymousRequested: (window.__hyWebkitAnonymousRequests ?? 0) > 0,
      childVisible: Boolean(document.querySelector(".ob-role-card--child")),
      hash: location.hash,
      inviteContext: document.querySelector(".ob-invite-context")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      pairingVisible: Boolean(document.querySelector(".ob-pairing")),
      parentVisible: Boolean(document.querySelector(".ob-role-card--parent")),
    }));
    await roleChoicePage.close();
    assert.equal(roleChoiceInvite.anonymousRequested, false, "공용 QR이 익명 아이 로그인을 시작했습니다");
    assert.equal(roleChoiceInvite.parentVisible, true, "공용 QR에서 학부모 역할을 선택할 수 없습니다");
    assert.equal(roleChoiceInvite.childVisible, true, "공용 QR에서 아이 역할을 선택할 수 없습니다");
    assert.equal(roleChoiceInvite.pairingVisible, false, "공용 QR이 역할 선택 전에 아이 페어링을 열었습니다");
    assert.ok(
      roleChoiceInvite.inviteContext?.includes("학부모인지 아이인지 선택"),
      `공용 QR 역할 안내가 불명확합니다: ${JSON.stringify(roleChoiceInvite)}`,
    );
    assert.equal(roleChoiceInvite.hash.includes("pair="), false, "처리한 공용 QR 파라미터가 Safari URL에 남았습니다");

    await page.goto(`${origin}/index.html#/onboarding`, { waitUntil: "domcontentloaded" });
    await page.locator(".ob-role-card--parent").waitFor({ state: "visible" });

    // iPhone급 WebKit 인증 진입점 — 실제 계정·SMS 없이 401 복구와 ID 중복확인을 검증한다.
    await page.getByRole("button", { name: /학부모/ }).click();
    await page.getByRole("tab", { name: "로그인", exact: true }).waitFor();
    const loginEntry = await page.evaluate(() => ({
      paddingTop: Number.parseFloat(getComputedStyle(document.querySelector(".ob-login")).paddingTop),
      paddingLeft: Number.parseFloat(getComputedStyle(document.querySelector(".ob-login")).paddingLeft),
      paddingRight: Number.parseFloat(getComputedStyle(document.querySelector(".ob-login")).paddingRight),
      selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
      hasLoginForm: Boolean(document.querySelector(".ob-login-form")),
      hasSignupTab: [...document.querySelectorAll('[role="tab"]')]
        .some((tab) => tab.textContent?.trim() === "회원가입"),
      hasKakao: Boolean(document.querySelector(".ob-social--kakao")),
      hasGoogle: Boolean(document.querySelector(".ob-social--google")),
    }));
    assert.deepEqual(
      { selectedTab: loginEntry.selectedTab, hasLoginForm: loginEntry.hasLoginForm, hasSignupTab: loginEntry.hasSignupTab },
      { selectedTab: "로그인", hasLoginForm: true, hasSignupTab: true },
    );
    assert.ok(loginEntry.paddingTop <= 24, `Safari 탭에서 로그인 화면 위 여백이 과도합니다: ${loginEntry.paddingTop}px`);
    assert.equal(loginEntry.paddingLeft, 16, "Safari 가입 단계 왼쪽 여백은 16px이어야 합니다");
    assert.equal(loginEntry.paddingRight, 16, "Safari 가입 단계 오른쪽 여백은 16px이어야 합니다");
    assert.equal(loginEntry.hasKakao, true, "한국 접속에서 카카오 로그인이 보여야 합니다");
    assert.equal(loginEntry.hasGoogle, true, "한국 접속에서 Google 로그인이 보여야 합니다");
    await page.locator("#hyeni-login-username").fill("mindlady");
    await page.locator("#hyeni-login-password").fill("incorrect-password");
    await page.locator(".ob-login-form").evaluate((form) => form.requestSubmit());
    await page.locator(".ob-auth-alert").waitFor({ state: "visible" });
    const wrongPassword = await page.evaluate(() => ({
      alert: document.querySelector(".ob-auth-alert")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      focusedId: document.activeElement?.id ?? null,
      loginId: document.querySelector("#hyeni-login-username")?.value ?? null,
      password: document.querySelector("#hyeni-login-password")?.value ?? null,
      sessionAbsent: localStorage.getItem("hyeni-api-session-v1") === null,
      submitEnabled: !document.querySelector(".ob-login-form button[type=submit]")?.disabled,
    }));
    authRequests = await page.evaluate(() => window.__hyWebkitAuthRequests ?? []);
    assert.ok(
      wrongPassword.alert?.includes("아이디 또는 비밀번호가 맞지 않아요"),
      `WebKit 잘못된 비밀번호 안내 불일치: ${JSON.stringify({ wrongPassword, authRequests })}`,
    );
    assert.equal(wrongPassword.focusedId, "hyeni-login-password");
    assert.equal(wrongPassword.loginId, "mindlady");
    assert.equal(wrongPassword.password, "incorrect-password");
    assert.equal(wrongPassword.sessionAbsent, true);
    assert.equal(wrongPassword.submitEnabled, true);

    // 같은 첫 문서 안에서 역할 화면으로 돌아가 Service Worker가 API mock보다 먼저
    // 새 문서를 제어하지 않게 한다. 제품 흐름의 실제 뒤로가기 복구도 함께 확인한다.
    await page.locator(".ob-back").click();
    await page.locator(".ob-role-card--parent").waitFor({ state: "visible" });
    await page.getByRole("button", { name: /학부모/ }).click();
    await page.getByRole("tab", { name: "회원가입", exact: true }).click();
    await page.getByRole("button", { name: "휴대폰 번호로 가입하기", exact: true }).click();
    await page.getByRole("button", { name: "선택 안 하고 계속", exact: true }).click();
    await page.locator("#hyeni-signup-username").fill("mindlady");
    await page.getByRole("button", { name: "중복 확인", exact: true }).click();
    await page.locator(".ob-field-success").waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    const signupEntry = await page.evaluate(() => ({
      available: document.querySelector(".ob-field-success")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      fieldError: document.querySelector("#ob-signup-login-id-error")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      formAlert: document.querySelector(".ob-auth-alert")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      loginId: document.querySelector("#hyeni-signup-username")?.value ?? null,
      title: document.querySelector(".ob-signup-title")?.textContent?.trim() ?? null,
    }));
    authRequests = await page.evaluate(() => window.__hyWebkitAuthRequests ?? []);
    assert.equal(signupEntry.loginId, "mindlady");
    assert.equal(
      signupEntry.available,
      "사용할 수 있는 아이디예요.",
      `WebKit ID 중복확인 불일치: ${JSON.stringify({ signupEntry, authRequests, externalAttempts })}`,
    );
    assert.equal(signupEntry.fieldError, null);
    assert.equal(signupEntry.title, "혜니 가족 시작하기");
    assert.deepEqual(authRequests, [
      { method: "POST", pathname: "/auth/login-password", status: 401 },
      { method: "POST", pathname: "/auth/check-login-id", status: 200 },
    ]);

    await page.goto(`${origin}/index.html#/subscription`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/#\/onboarding$/);
    await page.locator(".ob-root").waitFor({ state: "visible" });
    const guestSubscriptionRedirect = new URL(page.url()).hash;

    const serviceWorkerSupported = await page.evaluate(() => "serviceWorker" in navigator);
    assert.equal(serviceWorkerSupported, true, "WebKit에서 Service Worker를 지원하지 않습니다");
    await page.waitForFunction(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some((registration) => (
        new URL(registration.scope).pathname === "/" && registration.active?.state === "activated"
      ));
    }, undefined, { timeout: 15_000 });
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
        onboardingVisible: (() => {
          const onboarding = document.querySelector(".ob-root");
          if (!onboarding) return false;
          const rect = onboarding.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(onboarding).visibility !== "hidden";
        })(),
      };
    });
    assert.equal(offlineLayout.online, false);
    assert.equal(offlineLayout.controlled, true);
    assert.equal(offlineLayout.onboardingVisible, true);
    assert.equal(offlineLayout.cachedShellStatus, 200);
    assert.equal(offlineLayout.cachedShellHasRoot, true);
    assert.ok(offlineLayout.scrollWidth <= offlineLayout.clientWidth, "오프라인 온보딩에 가로 overflow가 있습니다");
    assert.equal(requests.length, requestCountBeforeOffline, "오프라인 Cache Storage 조회가 localhost 서버에 접근했습니다");
    const screenshot = await page.screenshot({ animations: "disabled", fullPage: true });
    await context.setOffline(false);

    assert.deepEqual(pageErrors, [], `page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(
      consoleProblems,
      [],
      `console problems: ${JSON.stringify(consoleProblems)}; HTTP errors: ${JSON.stringify(requests.filter(({ statusCode }) => statusCode >= 400))}`,
    );
    assert.deepEqual(externalAttempts, [], `외부 요청 시도: ${JSON.stringify(externalAttempts)}`);
    assert.equal(denyProxy.blockedConnections, 0, "외부망 차단 프록시에 연결 시도가 있었습니다");
    return {
      consoleProblems,
      externalAttempts,
      callbackEntryLoaded,
      callbackServiceWorkerScope,
      authEntry: { authRequests, loginEntry, signupEntry, wrongPassword },
      guestSubscriptionRedirect,
      offlineNavigation: "not verified: Playwright WebKit offline reload returned an internal engine error; Cache Storage shell verified instead",
      offlineLayout,
      onlineLayout,
      pageErrors,
      playwrightPackagePath: playwrightPackagePath.replaceAll("\\", "/"),
      registration,
      roleChoiceInvite,
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
