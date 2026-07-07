import test from "node:test";
import assert from "node:assert/strict";

import { messages, supportedLocales, getMessages } from "../src/i18n/messages.ts";

test("i18n 씨앗 구조는 새 리포트 화면의 핵심 문구를 4개 로케일에 제공한다", () => {
  assert.deepEqual(supportedLocales, ["ko", "ja", "zh-TW", "en"]);
  for (const locale of supportedLocales) {
    assert.equal(typeof messages[locale].dailyReportTitle, "string");
    assert.equal(messages[locale].dailyReportTitle.length > 0, true);
    assert.equal(typeof messages[locale].dailyReportSubtitle, "string");
    assert.equal(messages[locale].dailyReportSubtitle.length > 0, true);
    assert.equal(typeof messages[locale].weeklyReportTitle, "string");
    assert.equal(messages[locale].weeklyReportTitle.length > 0, true);
  }
});

test("지원하지 않는 로케일은 한국어 문구로 안전하게 폴백한다", () => {
  assert.equal(getMessages("fr").dailyReportTitle, messages.ko.dailyReportTitle);
});
