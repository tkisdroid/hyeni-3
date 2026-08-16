import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createIntl, createIntlCache } from "react-intl";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const personaKeys = ["rabbit", "cat", "fox", "dog", "bear", "panda"];
const helperPath = resolve(rootDir, "src/transform/aiFriendDisplay.ts");
const routeHelperPath = resolve(rootDir, "src/transform/routeExternalUrl.ts");

function source(path) {
  return readFileSync(resolve(rootDir, path), "utf8");
}

function childCatalog(locale) {
  return JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/child.json`), "utf8"));
}

test("AI 친구 표시 필드는 안정적인 persona key와 카탈로그 ID를 사용하고 서버 정본 원문은 보존한다", () => {
  const setup = source("src/screens/child/AiFriendSetup.tsx");
  const chat = source("src/screens/child/AiFriendChat.tsx");

  for (const key of personaKeys) assert.match(setup, new RegExp(`key: ["']${key}["']`), key);
  assert.match(setup, /species:\s*["']토끼["']/);
  assert.match(setup, /tone:\s*["']활발하고 친근한["']/);
  assert.match(setup, /greeting:\s*["']안녕! 나 통통이야\. 오늘은 뭐가 궁금해\?["']/);
  assert.match(setup, /aiFriendPersonaMessageId|child\.aiPersona\./);
  assert.doesNotMatch(setup, />\s*\{persona\.(?:species|tone|greeting)\}/);
  assert.doesNotMatch(chat, /persona\.greeting\.split/);
  assert.doesNotMatch(chat, /`[^`]*\$\{(?:pendingSupply\.label|nextEvent\.(?:title|time))\}/);
});

test("10개 locale은 AI persona 표시 문구와 클라이언트 인사 ICU 변수를 완전하게 제공한다", () => {
  for (const locale of locales) {
    const catalog = childCatalog(locale);
    for (const key of personaKeys) {
      for (const field of ["species", "tone", "greeting", "intro"]) {
        const id = `child.aiPersona.${key}.${field}`;
        assert.equal(typeof catalog[id], "string", `${locale}:${id}`);
        assert.ok(catalog[id].trim(), `${locale}:${id}: 빈 번역`);
      }
    }
    assert.match(catalog["child.aiSetup.personaSummary"] ?? "", /\{tone\}/);
    assert.match(catalog["child.aiSetup.personaSummary"] ?? "", /\{species\}/);
    assert.match(catalog["child.aiChat.greeting.supply"] ?? "", /\{intro\}/);
    assert.match(catalog["child.aiChat.greeting.supply"] ?? "", /\{supplyLabel\}/);
    assert.match(catalog["child.aiChat.greeting.event"] ?? "", /\{intro\}/);
    assert.match(catalog["child.aiChat.greeting.event"] ?? "", /\{eventTime\}/);
    assert.match(catalog["child.aiChat.greeting.event"] ?? "", /\{eventTitle\}/);
  }
});

test("AI 친구 클라이언트 인사는 원본 준비물·일정 문자열을 ICU 변수로 보존한다", async () => {
  assert.equal(existsSync(helperPath), true, "AI 친구 표시용 순수 helper가 필요합니다");
  const { resolveAiFriendClientGreeting } = await import(pathToFileURL(helperPath));

  const en = createIntl({ locale: "en", messages: childCatalog("en") }, createIntlCache());
  assert.equal(
    resolveAiFriendClientGreeting(en, "rabbit", { supplyLabel: "Math kit" }),
    "Hi! You still haven't packed “Math kit” today, right? Want to check it together? 😊",
  );
  const ja = createIntl({ locale: "ja", messages: childCatalog("ja") }, createIntlCache());
  assert.equal(
    resolveAiFriendClientGreeting(ja, "cat", { eventTitle: "ピアノ Lesson", eventTime: "15:30" }),
    "ニャー！今日は15:30にピアノ Lessonがあるね！準備はできた？",
  );
});

test("이름 없는 외부 경로 목적지는 호출 locale의 카탈로그 fallback으로 URL을 만든다", async () => {
  assert.equal(existsSync(routeHelperPath), true, "외부 지도 URL 순수 helper가 필요합니다");
  const { buildKakaoToUrl } = await import(pathToFileURL(routeHelperPath));
  const routeView = source("src/screens/feature/RouteView.tsx");

  assert.match(routeView, /shared\.routeView\.destinationFallback/);
  assert.doesNotMatch(routeView, /name\s*\|\|\s*["']도착지["']/);
  assert.match(
    buildKakaoToUrl("", "Destination", { lat: 37.5, lng: 127 }),
    /Destination,37\.5,127$/,
  );
  assert.match(
    buildKakaoToUrl("피아노 학원", "Destination", { lat: 37.5, lng: 127 }),
    /%ED%94%BC%EC%95%84%EB%85%B8%20%ED%95%99%EC%9B%90,37\.5,127$/,
  );
});
