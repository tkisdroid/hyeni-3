import test from "node:test";
import assert from "node:assert/strict";
import {
  localeDirection,
  localeFallbackChain,
  localizedBrandName,
  normalizeLocale,
  supportedLocales,
} from "../src/i18n/locale.ts";
import { resolveWebLocale } from "../src/i18n/localeStorage.ts";

test("지원 locale과 중국어·레거시 별칭을 정규화한다", () => {
  assert.deepEqual(supportedLocales, [
    "ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil",
  ]);
  assert.equal(normalizeLocale("zh-Hans-SG"), "zh-CN");
  assert.equal(normalizeLocale("zh-HK"), "zh-TW");
  assert.equal(normalizeLocale("in-ID"), "id");
  assert.equal(normalizeLocale("tl-PH"), "fil");
  assert.equal(normalizeLocale("fr-FR"), "en");
});

test("비한국어 폴백과 브랜드 계약을 지킨다", () => {
  assert.deepEqual(localeFallbackChain("vi"), ["vi", "en", "ko"]);
  assert.deepEqual(localeFallbackChain("ko"), ["ko", "en"]);
  assert.equal(localizedBrandName("ko"), "혜니캘린더");
  // 2026-08-25 TK 승인 A안: 고유명 Hyeni 유지 + 일반명사 현지화.
  assert.equal(localizedBrandName("ja"), "Hyeni カレンダー");
  assert.equal(localizedBrandName("zh-TW"), "Hyeni 日曆");
  assert.equal(localizedBrandName("vi"), "Lịch Hyeni");
  assert.equal(localizedBrandName("fil"), "Kalendaryo Hyeni");
  assert.equal(localeDirection("th"), "ltr");
});

test("저장한 지원 언어를 브라우저 언어보다 우선한다", () => {
  assert.equal(resolveWebLocale({
    storedLocale: "ja",
    navigatorLanguages: ["vi-VN", "ko-KR"],
  }), "ja");
});

test("잘못 저장한 언어는 이후 지원 브라우저 언어를 가리지 않는다", () => {
  assert.equal(resolveWebLocale({
    storedLocale: "fr-FR",
    navigatorLanguages: ["fr-FR", "zh-Hant-HK"],
  }), "zh-TW");
  assert.equal(resolveWebLocale({
    storedLocale: null,
    navigatorLanguages: ["fr-FR"],
  }), "en");
});

test("저장한 선택이 없으면 접속 국가를 나타내는 시간대를 브라우저 언어보다 우선한다", () => {
  assert.equal(resolveWebLocale({
    storedLocale: null,
    navigatorLanguages: ["en-US"],
    timeZone: "Asia/Seoul",
  }), "ko");
  assert.equal(resolveWebLocale({
    storedLocale: null,
    navigatorLanguages: ["ko-KR"],
    timeZone: "Asia/Tokyo",
  }), "ja");
});
