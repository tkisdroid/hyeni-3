/**
 * 실기기 locale 화면 검증(CDP, 읽기 전용 + 언어 전환만).
 *
 * 목적: 언어를 바꾼 뒤 화면에 **원시 message id** 가 노출되지 않는지 실제 기기에서 확인한다.
 * 정적 검사(tests/i18nUiWiring.test.mjs)가 잡지 못하는 런타임 namespace 누락을 잡는 것이 목적이다.
 *
 * 원시 id 판정: 화면 innerText 에서 점 구분 식별자를 뽑아 `locales/ko/*.json` 의 실제 키 집합과 대조한다.
 * (임의의 점 표기 문자열이 아니라 카탈로그에 존재하는 id 만 위반으로 센다 — 오탐 방지.)
 *
 * 안전:
 *  - 세션·토큰을 읽거나 출력하지 않는다. 언어 외의 설정을 바꾸지 않는다.
 *  - 언어는 앱 UI(언어 선택기)로만 바꾸고, 끝나면 **원래 언어로 반드시 복원**한다.
 *  - 로그아웃·역할 전환·재페어링·SOS·force ring·주변소리를 수행하지 않는다.
 *
 * 사용:
 *   node scripts/verify-locale-screens-cdp.mjs
 *   CDP_PORT=9222 LOCALES=en,ja ROUTES=#/onboarding node scripts/verify-locale-screens-cdp.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const cdpPort = Number.parseInt(process.env.CDP_PORT ?? "9222", 10);
if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) {
  throw new Error("CDP_PORT가 올바르지 않습니다.");
}
const commandTimeoutMs = Number.parseInt(process.env.CDP_COMMAND_TIMEOUT_MS ?? "25000", 10);
const settleMs = Number.parseInt(process.env.SETTLE_MS ?? "1800", 10);
const localesToCheck = (process.env.LOCALES ?? "en,ja").split(",").map((s) => s.trim()).filter(Boolean);
const routesToCheck = (process.env.ROUTES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** 언어 선택기가 있는 화면. 온보딩은 첫 화면에 있고, 로그인 뒤에는 설정 행에만 있다. */
const selectorRoute = (process.env.SELECTOR_ROUTE ?? "").trim();

// ── 카탈로그 키 집합 로드 (원시 id 판정 기준) ──────────────────────────────
const localeDir = path.resolve("locales/ko");
const catalogIds = new Set();
for (const file of await readdir(localeDir)) {
  if (!file.endsWith(".json")) continue;
  const parsed = JSON.parse(await readFile(path.join(localeDir, file), "utf8"));
  for (const key of Object.keys(parsed)) catalogIds.add(key);
}
if (catalogIds.size === 0) throw new Error("locales/ko 카탈로그 키를 읽지 못했습니다.");

// ── CDP 연결 ────────────────────────────────────────────────────────────────
const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const target = targets.find((t) => (
  t?.type === "page"
  && typeof t.webSocketDebuggerUrl === "string"
  && String(t.url).startsWith("https://localhost/")
));
if (!target) throw new Error("혜니캘린더 WebView CDP 대상을 찾지 못했습니다.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeoutId = setTimeout(() => reject(new Error("CDP 연결 시간 초과")), commandTimeoutMs);
  socket.addEventListener("open", () => { clearTimeout(timeoutId); resolve(); }, { once: true });
  socket.addEventListener("error", () => { clearTimeout(timeoutId); reject(new Error("CDP 연결 실패")); }, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
socket.addEventListener("message", (event) => {
  let msg;
  try { msg = JSON.parse(String(event.data)); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, timeoutId } = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(timeoutId);
    if (msg.error) reject(new Error(String(msg.error.message).slice(0, 200)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params?.entry?.level)) {
    consoleErrors.push(String(msg.params.entry.text).slice(0, 200));
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ");
    consoleErrors.push(String(text).slice(0, 200));
  }
});
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} 응답 시간 초과`));
    }, commandTimeoutMs);
    pending.set(id, { resolve, reject, timeoutId });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text ?? "평가 실패").slice(0, 200));
  return r.result?.value;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Runtime.enable");
await send("Log.enable");

// ── 화면 스캔: 원시 id / 한국어 잔존 ────────────────────────────────────────
const CATALOG_IDS_JSON = JSON.stringify([...catalogIds]);

async function scanScreen() {
  return evaluate(`(() => {
    const ids = new Set(${CATALOG_IDS_JSON});
    const text = document.body?.innerText ?? "";
    // 점 구분 식별자 후보를 뽑아 카탈로그 키와 정확히 일치하는 것만 위반으로 센다.
    const candidates = text.match(/[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9_]+)+/g) ?? [];
    const rawIds = [...new Set(candidates.filter((c) => ids.has(c)))];
    const koreanMatches = [...new Set((text.match(/[가-힣]{2,}/g) ?? []))];
    const brandHits = {
      koreanBrand: (text.match(/혜니캘린더/g) ?? []).length,
      englishBrand: (text.match(/Hyeni Calendar/g) ?? []).length,
      bareHyeni: (text.match(/Hyeni(?! Calendar)/g) ?? []).length,
    };
    return {
      hash: location.hash,
      documentLang: document.documentElement.lang,
      storedLocale: localStorage.getItem("hyeni-locale-v1"),
      title: document.title,
      brandHits,
      textLength: text.trim().length,
      rawMessageIds: rawIds,
      rawMessageIdCount: rawIds.length,
      koreanSamples: koreanMatches.slice(0, 12),
      koreanCount: koreanMatches.length,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  })()`);
}

/**
 * 언어 선택기를 UI로 조작한다(저장소를 직접 쓰지 않는다).
 * DOM 정본은 `src/components/LanguageSelector.tsx` — 옵션은 `.hy-language__option[lang=<code>]`,
 * 접힌 형태는 `.hy-language__trigger`(첫 화면) 또는 `.hy-language__toggle`(설정 행)로 펼친다.
 */
async function switchLocaleViaUi(locale) {
  // 언어 선택기가 다른 화면에 있으면 먼저 그 화면으로 이동한다(설정 행 등).
  if (selectorRoute) {
    await evaluate(`location.hash = ${JSON.stringify(selectorRoute)}; true`);
    await delay(settleMs);
  }
  // 부모 설정의 언어 행(`.ps-language > .ps-nav`)은 접혀 있어 `.hy-language` 가 아직 DOM 에 없다.
  // 그 행을 먼저 눌러 선택기를 펼친다.
  const expanded = await evaluate(`(() => {
    if (document.querySelector(".hy-language")) return "already";
    const row = document.querySelector(".ps-language .ps-nav[aria-expanded], .ps-language .ps-nav");
    if (!row) return "no-row";
    row.click();
    return "clicked";
  })()`);
  if (expanded === "clicked") await delay(900);
  const found = await evaluate(`(() => {
    const wanted = ${JSON.stringify(locale)};
    const root = document.querySelector(".hy-language");
    if (!root) return "no-selector";
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const option = root.querySelector('.hy-language__option[lang="' + wanted + '"]');
    if (option && isVisible(option)) return "option-visible";
    const opener = root.querySelector(".hy-language__trigger, .hy-language__toggle");
    if (opener) { opener.click(); return "opened"; }
    return option ? "option-hidden" : "no-option";
  })()`);
  if (found === "no-selector") return { ok: false, reason: "화면에 언어 선택기(.hy-language)가 없습니다." };
  if (found === "no-option") return { ok: false, reason: `언어 ${locale} 항목이 선택기에 없습니다.` };
  if (found === "opened" || found === "option-hidden") await delay(600);
  const clicked = await evaluate(`(() => {
    const wanted = ${JSON.stringify(locale)};
    const option = document.querySelector('.hy-language__option[lang="' + wanted + '"]');
    if (!option) return "no-match";
    option.click();
    return "clicked";
  })()`);
  if (clicked === "no-match") return { ok: false, reason: `언어 ${locale} 항목을 클릭할 수 없습니다.` };
  await delay(settleMs);
  return { ok: true, via: found };
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const before = await scanScreen();
const originalLocale = before.storedLocale ?? "ko";
const results = { checkedAt: new Date().toISOString(), originalLocale, before, locales: [], restored: null };

for (const locale of localesToCheck) {
  const switched = await switchLocaleViaUi(locale);
  const entry = { locale, switched };
  if (switched.ok) {
    entry.screens = [];
    const routes = routesToCheck.length > 0 ? routesToCheck : [before.hash || "#/"];
    for (const hash of routes) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
      await delay(settleMs);
      entry.screens.push({ route: hash, ...(await scanScreen()) });
    }
  }
  results.locales.push(entry);
}

// ── 원래 언어 복원 (필수) ───────────────────────────────────────────────────
const restore = await switchLocaleViaUi(originalLocale);
results.restored = { requested: originalLocale, ...restore, after: await scanScreen() };

results.consoleErrors = [...new Set(consoleErrors)];

const outFile = (process.env.OUT_FILE ?? "").trim();
if (outFile) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outFile, JSON.stringify(results, null, 2), "utf8");
}

// 사람이 읽는 요약(콘솔 인코딩에 안전하도록 원문 대신 집계 위주).
console.log(`원래 locale=${originalLocale} · 복원 요청=${results.restored.requested} · 복원 후 저장값=${results.restored.after?.storedLocale} · 복원 ${results.restored.ok ? "성공" : "실패"}`);
for (const l of results.locales) {
  console.log(`\n=== ${l.locale} · 전환 ${l.switched.ok ? `성공(${l.switched.via})` : `실패(${l.switched.reason})`} ===`);
  for (const s of l.screens ?? []) {
    const parts = [
      s.route.padEnd(24),
      `lang=${s.documentLang}`,
      `len=${String(s.textLength).padStart(5)}`,
      `ko낱말=${String(s.koreanCount).padStart(3)}`,
      `brand[ko=${s.brandHits.koreanBrand} en=${s.brandHits.englishBrand} bare=${s.brandHits.bareHyeni}]`,
      `overflow=${s.horizontalOverflowPx}`,
    ];
    if (s.rawMessageIdCount > 0) parts.push(`원시id=${s.rawMessageIdCount}`);
    console.log(parts.join(" "));
    if (s.rawMessageIdCount > 0) console.log(`    ${s.rawMessageIds.slice(0, 6).join(" , ")}`);
  }
}
if (outFile) console.log(`\n전체 JSON: ${outFile}`);
socket.close();

const localeFailures = results.locales.flatMap((l) => (
  l.switched.ok
    ? (l.screens ?? []).filter((s) => s.rawMessageIdCount > 0 || s.textLength === 0).map((s) => ({ locale: l.locale, route: s.route, rawMessageIds: s.rawMessageIds }))
    : [{ locale: l.locale, switchFailed: l.switched.reason }]
));
const restoreFailed = results.restored.after?.storedLocale !== originalLocale;
if (localeFailures.length > 0 || restoreFailed) {
  console.error(JSON.stringify({ localeFailures, restoreFailed, storedLocaleAfter: results.restored.after?.storedLocale }, null, 2));
  process.exitCode = 1;
}
