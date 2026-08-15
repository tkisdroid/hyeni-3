import assert from "node:assert/strict";
import test from "node:test";

import { localeBootstrapCopy } from "../src/i18n/bootstrapCopy.ts";
import * as bootstrapModule from "../src/i18n/bootstrapCopy.ts";

const expected = {
  ko: ["언어 정보를 불러오지 못했어요", "연결을 확인한 뒤 다시 시도해 주세요.", "다시 시도"],
  en: ["Couldn't load your language", "Check your connection and try again.", "Try again"],
  ja: ["言語情報を読み込めませんでした", "接続を確認して、もう一度お試しください。", "再試行"],
  "zh-CN": ["无法加载语言信息", "请检查网络连接后重试。", "重试"],
  "zh-TW": ["無法載入語言資訊", "請檢查網路連線後再試一次。", "再試一次"],
  vi: ["Không thể tải thông tin ngôn ngữ", "Hãy kiểm tra kết nối rồi thử lại.", "Thử lại"],
  th: ["โหลดข้อมูลภาษาไม่ได้", "ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง", "ลองอีกครั้ง"],
  id: ["Bahasa tidak dapat dimuat", "Periksa koneksi, lalu coba lagi.", "Coba lagi"],
  ms: ["Maklumat bahasa tidak dapat dimuatkan", "Semak sambungan, kemudian cuba lagi.", "Cuba lagi"],
  fil: ["Hindi ma-load ang wika", "Tingnan ang koneksyon, pagkatapos ay subukan ulit.", "Subukan ulit"],
} as const;

test("IntlProvider 이전 catalog 실패·retry 문구는 runtime의 10개 locale을 따른다", () => {
  for (const [locale, values] of Object.entries(expected)) {
    const copy = localeBootstrapCopy(locale as keyof typeof expected);
    assert.deepEqual([copy.title, copy.body, copy.retry], values, locale);
  }
});

test("core catalog 실패 전에도 10개 locale의 document lang·dir·안전 title을 적용한다", () => {
  const apply = (bootstrapModule as Record<string, unknown>).applyBootstrapDocumentLocale;
  assert.equal(typeof apply, "function");
  for (const locale of Object.keys(expected)) {
    const meta = { content: "" };
    const documentLike = {
      documentElement: { lang: "ko", dir: "ltr" },
      title: "혜니캘린더",
      querySelector() { return { setAttribute(_name: string, value: string) { meta.content = value; } }; },
    };
    (apply as (locale: string, target: typeof documentLike) => void)(locale, documentLike);
    assert.equal(documentLike.documentElement.lang, locale, locale);
    assert.equal(documentLike.documentElement.dir, "ltr", locale);
    assert.equal(documentLike.title, locale === "ko" ? "혜니캘린더" : "Hyeni Calendar", locale);
    assert.equal(meta.content, documentLike.title, locale);
  }
});
