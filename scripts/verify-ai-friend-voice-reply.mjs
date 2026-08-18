/**
 * 아이 AI 친구 음성 답변 격리 브라우저 QA.
 *
 * production dist를 localhost preview로만 열고, 운영 API·realtime은 브라우저에서
 * 전부 가로채 가짜 응답으로 닫는다. 실계정·실서버·실기기에는 접근하지 않는다.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://127.0.0.1:4184";
const API_ORIGIN = "https://hyeni-calendar-api.tkisdroid.workers.dev";
const KAKAO_SDK_ORIGIN = "https://dapi.kakao.com";
const VOICE_SETTING_KEY = "hyeni-child-voice-reply-voice-fam:voice-child";
const PREVIEW_READY_TIMEOUT_MS = 20_000;
const REQUIRED_DIST_FILES = ["dist/index.html", "dist/sw.js", "dist/manifest.webmanifest"];

// 이 하니스가 응답해도 되는 외부 HTTP 계약. OPTIONS도 여기의 실제 method/path만 허용한다.
const EXTERNAL_HTTP_ALLOWLIST = new Set([
  "GET /api/family/mine",
  "GET /api/events",
  "GET /api/saved-places",
  "GET /api/daily-supplies",
  "GET /api/ai/messages",
  "GET /api/ai/settings/friend-public",
  "GET /api/ai/credits/public-status",
  "GET /api/stickers/received",
  "GET /api/memos/replies",
  "POST /api/ai/child-chat",
  "POST /rest/v1/rpc/get_pending_notifications_for_device",
  "POST /api/realtime/ticket",
  "PATCH /api/family/member/device",
]);
const KAKAO_SDK_CONTRACT = "GET /v2/maps/sdk.js";

const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const mockAccessJwt = `${toBase64Url({ alg: "HS256", typ: "JWT" })}.${toBase64Url({
  sub: "voice-child",
  role: "child",
  family_id: "voice-fam",
  exp: Math.floor(Date.now() / 1000) + 3_600,
})}.voice-qa`;

const persistedSession = {
  access: mockAccessJwt,
  refresh: "mock-refresh",
  user: {
    id: "voice-child",
    app_metadata: { role: "child", family_id: "voice-fam" },
    user_metadata: { role: "child", family_id: "voice-fam" },
  },
  session_instance_id: "voice-qa",
};

const apiFixtures = {
  "/api/family/mine": {
    familyId: "voice-fam",
    myRole: "child",
    myName: "혜니",
    parentName: "부모",
    primaryParentId: "voice-parent",
    isPrimaryParent: false,
    isCoParent: false,
    members: [
      { id: "voice-parent-member", user_id: "voice-parent", role: "parent", name: "부모" },
      { id: "voice-child-member", user_id: "voice-child", role: "child", name: "혜니" },
    ],
  },
  "/api/events": [],
  "/api/saved-places": [],
  "/api/daily-supplies": [],
  "/api/ai/messages": [],
  "/api/ai/settings/friend-public": { ai_friend_name: "통통이" },
  "/api/stickers/received": [],
  "/api/memos/replies": [],
  "/api/ai/credits/public-status": {
    is_premium: false,
    daily_included_limit: 5,
    daily_included_used: 0,
    daily_reset_date: new Date().toISOString().slice(0, 10),
    purchased_credits: 0,
    parent_daily_used: 0,
    parent_daily_limit: 5,
    available_remaining: 5,
    unlimited: false,
  },
};

const mockRealtimeTicket = `${toBase64Url({ alg: "HS256", typ: "JWT" })}.${toBase64Url({
  sub: "voice-child",
  family_id: "voice-fam",
  nonce: "voice-qa-ticket".repeat(6),
})}.voice-qa-signature`;

let assistantSequence = 0;

function childChatReply(message) {
  if (message === "오류 답") return { status: 503, body: { error: "ai_provider_busy" } };
  if (message === "빈 답") return { status: 200, body: { reply: "", remaining: 4 } };
  const reply = message === "음성 질문" ? "음성 답변" : `글 답변 ${message}`;
  assistantSequence += 1;
  return {
    status: 200,
    body: {
      reply,
      remaining: 4,
      assistantMessageId: `00000000-0000-4000-8000-${String(assistantSequence).padStart(12, "0")}`,
    },
  };
}

async function verifyFreshDist() {
  for (const relativePath of REQUIRED_DIST_FILES) {
    assert.ok(existsSync(resolve(ROOT, relativePath)), `${relativePath}가 없습니다. 먼저 npm run build를 실행해 주세요.`);
  }

  const assetNames = await readdir(resolve(ROOT, "dist/assets"));
  const chatAssets = assetNames.filter((name) => /^AiFriendChat-[\w-]+\.js$/.test(name));
  assert.equal(chatAssets.length, 1, "AI 친구 lazy asset이 정확히 1개가 아닙니다. npm run build를 다시 실행해 주세요.");

  const sourcePaths = [
    resolve(ROOT, "src/screens/child/AiFriendChat.tsx"),
    resolve(ROOT, "src/transform/childVoiceChat.ts"),
  ];
  const sourceStats = await Promise.all(sourcePaths.map((path) => stat(path)));
  const assetPath = resolve(ROOT, "dist/assets", chatAssets[0]);
  const assetStat = await stat(assetPath);
  const newestSourceMtimeMs = Math.max(...sourceStats.map((entry) => entry.mtimeMs));
  assert.ok(
    assetStat.mtimeMs >= newestSourceMtimeMs,
    "AI 친구 dist asset이 소스보다 오래됐습니다. 먼저 npm run build를 실행해 주세요.",
  );
  return chatAssets[0];
}

function externalHttpContract(request, url) {
  const method = request.method().toUpperCase();
  if (url.origin === KAKAO_SDK_ORIGIN) {
    const contract = `${method} ${url.pathname}`;
    return contract === KAKAO_SDK_CONTRACT
      ? { contract, preflight: false, fixture: "kakao-sdk" }
      : null;
  }
  if (url.origin !== API_ORIGIN) return null;
  if (method === "OPTIONS") {
    const requestedMethod = String(request.headers()["access-control-request-method"] ?? "").toUpperCase();
    const requestedContract = `${requestedMethod} ${url.pathname}`;
    return EXTERNAL_HTTP_ALLOWLIST.has(requestedContract)
      ? { contract: requestedContract, preflight: true, fixture: "api" }
      : null;
  }
  const contract = `${method} ${url.pathname}`;
  return EXTERNAL_HTTP_ALLOWLIST.has(contract)
    ? { contract, preflight: false, fixture: "api" }
    : null;
}

async function waitForPreview(preview) {
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (preview.exitCode != null) {
      throw new Error(`Vite preview가 준비되기 전에 종료됐습니다(exit ${preview.exitCode}).`);
    }
    try {
      const response = await fetch(`${ORIGIN}/index.html`, { redirect: "error" });
      if (response.status === 200) return;
    } catch {
      // 고정 localhost preview가 뜰 때까지 짧게 다시 확인한다.
    }
    await wait(100);
  }
  throw new Error("Vite preview가 20초 안에 준비되지 않았습니다.");
}

async function stopPreview(preview) {
  if (!preview || preview.exitCode != null || preview.signalCode != null) return;
  const pid = preview.pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "정리할 preview PID가 올바르지 않습니다.");

  const exited = once(preview, "exit").then(() => true);
  preview.kill("SIGTERM");
  const stopped = await Promise.race([
    exited,
    wait(2_000).then(() => false),
  ]);
  if (stopped || preview.exitCode != null || preview.signalCode != null) return;

  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: ROOT,
      stdio: "ignore",
      windowsHide: true,
    });
    await once(taskkill, "exit");
    return;
  }
  preview.kill("SIGKILL");
}

async function readVoiceState(page) {
  return page.evaluate((key) => localStorage.getItem(key) ?? "off", VOICE_SETTING_KEY);
}

async function voiceQaState(page) {
  return page.evaluate(() => ({
    spoken: [...window.__hyeniVoiceQa.spoken],
    events: [...window.__hyeniVoiceQa.events],
  }));
}

async function sendTyped(page, message, expectedReply) {
  await page.locator(".afc-field").fill(message);
  await page.locator(".afc-send").click();
  await page.locator(".afc-bubble--ai", { hasText: expectedReply }).last().waitFor({ state: "visible" });
}

async function run() {
  const distAsset = await verifyFreshDist();
  const preview = spawn(
    process.execPath,
    [resolve(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4184", "--strictPort"],
    { cwd: ROOT, stdio: "ignore", windowsHide: true },
  );
  let browser = null;
  let mockedExternalRequests = 0;
  let mockedWebSockets = 0;
  const continuedLocalRequests = [];
  const unmockedExternalRequests = [];
  const pageErrors = [];
  let interruptOrder = [];

  try {
    await waitForPreview(preview);
    const launchOptions = {
      headless: true,
      args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
    };
    try {
      browser = await chromium.launch(launchOptions);
    } catch (error) {
      const systemChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
      if (!String(error).includes("Executable doesn't exist") || !existsSync(systemChrome)) throw error;
      browser = await chromium.launch({ ...launchOptions, executablePath: systemChrome });
    }
    const context = await browser.newContext({ serviceWorkers: "block", locale: "ko-KR" });

    const cors = {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-headers": "authorization,content-type,x-device-install-id",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    };

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === ORIGIN && ["GET", "HEAD"].includes(request.method())) {
        continuedLocalRequests.push({ method: request.method(), path: url.pathname });
        await route.continue();
        return;
      }

      // localhost라도 정적 GET/HEAD가 아니면 실제 preview로 넘기지 않는다.
      if (url.origin === ORIGIN) {
        await route.fulfill({ status: 404, body: "" });
        return;
      }

      const contract = externalHttpContract(request, url);
      if (!contract) {
        unmockedExternalRequests.push({ method: request.method(), path: url.pathname });
        await route.fulfill({
          status: 404,
          headers: { ...cors, "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ error: "qa_unmocked_route" }),
        });
        return;
      }

      mockedExternalRequests += 1;
      if (contract.preflight) {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      if (contract.fixture === "kakao-sdk") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/javascript; charset=utf-8" },
          body: "window.kakao={maps:{load:function(callback){callback();}}};",
        });
        return;
      }

      let status = 200;
      let body;
      if (request.method() === "POST" && url.pathname === "/api/ai/child-chat") {
        const requestBody = request.postDataJSON();
        assert.equal(typeof requestBody?.message, "string", "AI 대화 mock 요청에 message가 없습니다.");
        const result = childChatReply(requestBody.message);
        status = result.status;
        body = result.body;
      } else if (request.method() === "POST" && url.pathname === "/rest/v1/rpc/get_pending_notifications_for_device") {
        body = [];
      } else if (request.method() === "POST" && url.pathname === "/api/realtime/ticket") {
        body = {
          ticket: mockRealtimeTicket,
          expires_at: new Date(Date.now() + 30_000).toISOString(),
          expires_in: 30,
        };
      } else if (request.method() === "PATCH" && url.pathname === "/api/family/member/device") {
        body = { ok: true };
      } else if (request.method() === "GET" && Object.hasOwn(apiFixtures, url.pathname)) {
        body = apiFixtures[url.pathname];
      } else {
        assert.fail(`allowlist 응답 구현이 없습니다: ${contract.contract}`);
      }

      await route.fulfill({
        status,
        headers: { ...cors, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
    });
    await context.routeWebSocket("**", (socket) => {
      mockedWebSockets += 1;
      socket.close();
    });

    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
    await page.addInitScript(({ session }) => {
      class FakeSpeechRecognition {
        lang = "";
        interimResults = false;
        maxAlternatives = 1;
        onresult = null;
        onerror = null;
        onend = null;

        start() {
          queueMicrotask(() => {
            const transcript = window.__hyeniVoiceQa.transcript;
            this.onresult?.({ results: [[{ transcript }]] });
          });
        }

        stop() {
          queueMicrotask(() => this.onend?.());
        }
      }

      class FakeSpeechSynthesisUtterance {
        constructor(text) {
          this.text = String(text ?? "");
          this.lang = "";
          this.rate = 1;
        }
      }

      window.__hyeniVoiceQa = {
        transcript: "",
        spoken: [],
        events: [],
      };
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: FakeSpeechRecognition,
      });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        configurable: true,
        value: FakeSpeechRecognition,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: FakeSpeechSynthesisUtterance,
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          cancel() {
            window.__hyeniVoiceQa.events.push("cancel");
          },
          speak(utterance) {
            window.__hyeniVoiceQa.events.push("speak");
            window.__hyeniVoiceQa.spoken.push({
              text: String(utterance.text ?? ""),
              lang: String(utterance.lang ?? ""),
            });
          },
        },
      });
      localStorage.setItem("hyeni-api-session-v1", JSON.stringify(session));
      localStorage.setItem("hyeni-locale-v1", "ko");
    }, { session: persistedSession });

    await page.goto(`${ORIGIN}/index.html#/child/ai-friend`, { waitUntil: "domcontentloaded" });
    await page.locator(".afc").waitFor({ state: "visible", timeout: 20_000 });
    const mic = page.locator(".afc-mic");
    const voiceToggle = page.locator(".afc-voicetog");
    await mic.waitFor({ state: "visible" });
    await voiceToggle.waitFor({ state: "visible" });

    assert.equal(await voiceToggle.getAttribute("aria-pressed"), "false", "읽어주기 기본값이 off가 아닙니다.");
    assert.equal(await readVoiceState(page), "off", "읽어주기 기본 저장 상태가 off가 아닙니다.");

    // 기본 off + 음성 질문: source=voice인 이번 답만 자동 재생한다.
    await page.evaluate(() => { window.__hyeniVoiceQa.transcript = "음성 질문"; });
    await mic.click();
    await page.waitForFunction(() => window.__hyeniVoiceQa.spoken.length === 1);
    let state = await voiceQaState(page);
    assert.deepEqual(state.spoken[0], { text: "음성 답변", lang: "ko-KR" });
    assert.equal(await voiceToggle.getAttribute("aria-pressed"), "false", "음성 turn이 영구 설정을 켰습니다.");
    assert.equal(await readVoiceState(page), "off", "음성 turn 뒤 영구 설정이 off로 유지되지 않았습니다.");

    // 기본 off + 글 질문: 자동 재생하지 않는다.
    await sendTyped(page, "글 질문", "글 답변 글 질문");
    state = await voiceQaState(page);
    assert.equal(state.spoken.length, 1, "설정 off인데 글 답변을 읽었습니다.");

    // 토글 on + 글 질문: 기존 영구 설정 의미를 그대로 유지한다.
    await voiceToggle.click();
    assert.equal(await voiceToggle.getAttribute("aria-pressed"), "true");
    assert.equal(await readVoiceState(page), "on");
    await sendTyped(page, "글 질문 켬", "글 답변 글 질문 켬");
    await page.waitForFunction(() => window.__hyeniVoiceQa.spoken.length === 2);
    state = await voiceQaState(page);
    assert.deepEqual(state.spoken[1], { text: "글 답변 글 질문 켬", lang: "ko-KR" });

    // 빈 답과 오류 답은 합성하지 않는다.
    await sendTyped(page, "빈 답", "지금은 대답을 못 받았어");
    assert.equal((await voiceQaState(page)).spoken.length, 2, "빈 답을 합성했습니다.");
    await sendTyped(page, "오류 답", "지금은 내가 대답을 못 해");
    assert.equal((await voiceQaState(page)).spoken.length, 2, "오류 답을 합성했습니다.");

    // 새 마이크를 누르면 다음 답을 말하기 전에 진행 중 TTS를 먼저 끊는다.
    await page.evaluate(() => {
      window.__hyeniVoiceQa.events.length = 0;
      window.__hyeniVoiceQa.transcript = "음성 질문";
    });
    await mic.click();
    await page.waitForFunction(() => window.__hyeniVoiceQa.spoken.length === 3);
    state = await voiceQaState(page);
    const firstCancel = state.events.indexOf("cancel");
    const nextSpeak = state.events.indexOf("speak");
    assert.ok(firstCancel >= 0 && nextSpeak > firstCancel, "새 음성 turn이 TTS 중단보다 먼저 말했습니다.");
    interruptOrder = [...state.events];

    // 토글 off는 지금 읽던 말도 즉시 중단한다.
    const eventsBeforeToggleOff = state.events.length;
    await voiceToggle.click();
    state = await voiceQaState(page);
    assert.equal(await voiceToggle.getAttribute("aria-pressed"), "false");
    assert.equal(await readVoiceState(page), "off");
    assert.equal(state.events.length, eventsBeforeToggleOff + 1);
    assert.equal(state.events.at(-1), "cancel");

    // 화면 이탈 시 cleanup에서도 TTS를 멈춘다.
    await page.evaluate(() => { window.__hyeniVoiceQa.events.length = 0; });
    await page.evaluate(() => { location.hash = "#/child/home"; });
    await page.waitForFunction(() => !document.querySelector(".afc"));
    state = await voiceQaState(page);
    assert.ok(state.events.includes("cancel"), "AI 친구 화면 이탈 시 TTS를 중단하지 않았습니다.");

    // 컨텍스트를 먼저 닫아 더 들어올 요청이 없게 만든 뒤 네트워크 감사를 확정한다.
    await context.close();
    const unmockedExternalSnapshot = [...unmockedExternalRequests];

    assert.equal(pageErrors.length, 0, `브라우저 page error: ${pageErrors.join(" | ")}`);
    assert.ok(continuedLocalRequests.length > 0, "localhost 정적 asset 요청을 확인하지 못했습니다.");
    assert.ok(mockedExternalRequests > 0, "외부 API mock 차단 경로가 실행되지 않았습니다.");
    assert.deepEqual(
      unmockedExternalSnapshot,
      [],
      `allowlist 밖 외부 요청: ${unmockedExternalSnapshot.map(({ method, path }) => `${method} ${path}`).join(", ")}`,
    );

    console.log([
      "AI 친구 음성 답변 격리 QA 통과",
      "voice=1",
      "voiceReply=음성_답변",
      "textOff=0",
      "textOn=1",
      "textReply=글_답변",
      "empty=0",
      "error=0",
      "persistentAfterVoice=off",
      `interruptEvents=${interruptOrder.length}`,
      `interruptOrder=${interruptOrder.join(">")}`,
      `unmountEvents=${state.events.length}:${state.events.join(">")}`,
      `distAsset=${distAsset}`,
      `continuedLocalRequests=${continuedLocalRequests.length}`,
      `mockedExternalRequests=${mockedExternalRequests}`,
      `mockedWebSockets=${mockedWebSockets}`,
      "unmockedExternalRequests=0",
      "isolation=sw-blocked,dns-denied,http-fulfilled,ws-closed",
    ].join(" "));
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await stopPreview(preview);
    }
  }
}

await run();
