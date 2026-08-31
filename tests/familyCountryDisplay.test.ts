import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { formatFamilyCountryName } from "../src/transform/familyCountryDisplay.ts";

test("가족 국가는 각 앱 locale의 Intl.DisplayNames로 표시한다", () => {
  assert.equal(formatFamilyCountryName("KR", "ko"), "대한민국");
  assert.equal(formatFamilyCountryName("JP", "en"), "Japan");
  assert.equal(formatFamilyCountryName("TW", "ja"), "台湾");
});

test("DisplayNames 미지원 runtime에서는 정규화한 ISO 코드만 표시한다", () => {
  const original = Intl.DisplayNames;
  // 오래된 WebView를 재현한다.
  Object.defineProperty(Intl, "DisplayNames", { value: undefined, configurable: true });
  try {
    assert.equal(formatFamilyCountryName(" jp ", "ko"), "JP");
    assert.equal(formatFamilyCountryName("JPN", "ko"), "ZZ");
  } finally {
    Object.defineProperty(Intl, "DisplayNames", { value: original, configurable: true });
  }
});
