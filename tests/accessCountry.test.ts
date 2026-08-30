import test from "node:test";
import assert from "node:assert/strict";
import {
  accessCountryFromClientHints,
  localeForAccessCountry,
  normalizeAccessCountry,
  socialProvidersForAccessCountry,
} from "../src/transform/accessCountry.ts";

test("접속 시간대와 브라우저 지역에서 지원 국가를 안정적으로 판정한다", () => {
  assert.equal(accessCountryFromClientHints({ timeZone: "Asia/Seoul", navigatorLanguages: ["en-US"] }), "KR");
  assert.equal(accessCountryFromClientHints({ timeZone: "Asia/Tokyo", navigatorLanguages: ["ko-KR"] }), "JP");
  assert.equal(accessCountryFromClientHints({ timeZone: "UTC", navigatorLanguages: ["vi-VN"] }), "VN");
  assert.equal(accessCountryFromClientHints({ timeZone: "UTC", navigatorLanguages: ["fr-FR"] }), "FR");
});

test("접속 국가에 맞는 첫 언어를 고르고 미지원 국가는 영어로 닫는다", () => {
  assert.equal(localeForAccessCountry("KR"), "ko");
  assert.equal(localeForAccessCountry("TW"), "zh-TW");
  assert.equal(localeForAccessCountry("PH"), "fil");
  assert.equal(localeForAccessCountry("FR"), "en");
  assert.equal(normalizeAccessCountry("xx"), "ZZ");
  assert.equal(normalizeAccessCountry("T1"), "ZZ");
});

test("한국 접속도 Naver 설정과 무관하게 카카오와 Google 로그인만 노출한다", () => {
  assert.deepEqual(socialProvidersForAccessCountry("KR"), ["kakao", "google"]);
  assert.deepEqual(socialProvidersForAccessCountry("JP"), ["google"]);
  assert.deepEqual(socialProvidersForAccessCountry("ZZ"), ["kakao", "google"]);
});
