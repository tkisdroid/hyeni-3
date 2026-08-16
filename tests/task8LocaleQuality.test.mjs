import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const auditPath = resolve(rootDir, "scripts/i18n/audit-task8-locales.mjs");

function catalog(locale, namespace) {
  return JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/${namespace}.json`), "utf8"));
}

test("Task 8 locale 감사기는 Unicode·따옴표·공백을 정규화해 fallback을 비교한다", async () => {
  assert.equal(existsSync(auditPath), true, "Task 8 locale 감사 스크립트가 필요합니다");
  const { normalizeCopy } = await import(pathToFileURL(auditPath));
  assert.equal(normalizeCopy("  A\u00a0B “Test”  "), 'a b "test"');
  assert.equal(normalizeCopy("Ａ  B\n‘Test’"), "a b 'test'");
});

test("Task 8 추가 ID는 영어 fallback·zh-TW 간체 혼입·브랜드 변형이 없다", async () => {
  assert.equal(existsSync(auditPath), true, "Task 8 locale 감사 스크립트가 필요합니다");
  const { auditTask8Locales } = await import(pathToFileURL(auditPath));
  const result = auditTask8Locales(rootDir);
  assert.deepEqual(result.violations, [], result.violations.join("\n"));
  assert.ok(result.auditedMessageCount >= 2_000, "Task 8 추가 메시지 전체를 감사해야 합니다");
});

test("비한국어 브랜드 표기는 manifest 정본 Hyeni Calendar만 사용한다", () => {
  const manifest = JSON.parse(readFileSync(resolve(rootDir, "locales/manifest.json"), "utf8"));
  for (const locale of manifest.locales.filter(({ code }) => code !== "ko")) {
    assert.equal(locale.brandName, "Hyeni Calendar", locale.code);
  }
});

test("안심 리포트의 앱 사용·안전 상태는 주체와 의미를 바꾸지 않는다", () => {
  const expected = {
    ja: ["Hyeni Calendar以外に、今日はほかのアプリを使っていません。", "安全確認は良好です", "今日のお子さまの活動に、特別な危険の兆候はありません。"],
    "zh-CN": ["除了 Hyeni Calendar 之外，今天没有使用其他应用。", "安全检查结果良好", "今天孩子的活动中未发现异常安全信号。"],
    "zh-TW": ["除了 Hyeni Calendar 之外，今天沒有使用其他應用程式。", "安全檢查結果良好", "今天孩子的活動中未發現異常安全訊號。"],
    vi: ["Ngoài Hyeni Calendar, hôm nay không dùng ứng dụng nào khác.", "Các kiểm tra an toàn đều ổn", "Không phát hiện tín hiệu an toàn bất thường nào trong hoạt động của bé hôm nay."],
    th: ["นอกจาก Hyeni Calendar แล้ว วันนี้ไม่ได้ใช้แอปอื่น", "ผลการตรวจสอบความปลอดภัยปกติดี", "ไม่พบสัญญาณอันตรายผิดปกติในกิจกรรมของเด็กวันนี้"],
    id: ["Selain Hyeni Calendar, tidak ada aplikasi lain yang digunakan hari ini.", "Pemeriksaan keamanan berjalan baik", "Tidak ditemukan tanda bahaya yang tidak biasa dalam aktivitas anak hari ini."],
    ms: ["Selain Hyeni Calendar, tiada apl lain digunakan hari ini.", "Pemeriksaan keselamatan berjalan baik", "Tiada tanda keselamatan luar biasa dikesan dalam aktiviti anak hari ini."],
    fil: ["Maliban sa Hyeni Calendar, walang ibang app na ginamit ngayong araw.", "Maayos ang mga pagsusuri sa kaligtasan", "Walang nakitang kakaibang senyales ng panganib sa mga aktibidad ng bata ngayong araw."],
  };
  for (const [locale, values] of Object.entries(expected)) {
    const reports = catalog(locale, "reports");
    assert.equal(reports["reports.daily.noOtherApps"], values[0], `${locale}: 앱 사용 의미`);
    assert.equal(reports["reports.daily.status.safe.title"], values[1], `${locale}: 안전 상태 제목`);
    assert.equal(reports["reports.daily.status.safe.description"], values[2], `${locale}: 안전 상태 설명`);
  }
});
