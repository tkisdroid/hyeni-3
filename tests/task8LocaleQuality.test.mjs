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

test("영어 동일값 예외는 locale·ID·승인값·근거가 모두 맞아야 하며 stale 예외를 남기지 않는다", async () => {
  const audit = await import(pathToFileURL(auditPath));
  assert.ok(Array.isArray(audit.identicalEnglishAllowlist), "exact 영어 동일값 예외 목록을 공개해야 합니다");
  for (const entry of audit.identicalEnglishAllowlist) {
    assert.deepEqual(Object.keys(entry).sort(), ["id", "locale", "reason", "value"]);
    assert.match(entry.locale, /^(?:ja|zh-CN|zh-TW|vi|th|id|ms|fil)$/);
    assert.ok(entry.id.includes("."));
    assert.ok(entry.value.trim());
    assert.ok(entry.reason.trim());
  }

  const normal = audit.auditTask8Locales(rootDir);
  assert.equal(normal.allowlistEntries, audit.identicalEnglishAllowlist.length);
  assert.equal(normal.consumedAllowlistEntries, normal.allowlistEntries);

  const changedApprovedValue = audit.auditTask8Locales(rootDir, {
    messageOverrides: {
      "en:billing:billing.common.premium": "Arbitrary paid tier",
      "vi:billing:billing.common.premium": "Arbitrary paid tier",
    },
  });
  assert.match(changedApprovedValue.violations.join("\n"), /english_fallback:vi:billing\.common\.premium/);

  const staleAllowance = audit.auditTask8Locales(rootDir, {
    identicalEnglishAllowlist: [
      ...audit.identicalEnglishAllowlist,
      { locale: "ja", id: "child.sos.title", value: "NOT-CONSUMED", reason: "stale 검증 fixture" },
    ],
  });
  assert.match(staleAllowance.violations.join("\n"), /stale_english_allowance:ja:child\.sos\.title/);

  const duplicateAllowance = audit.auditTask8Locales(rootDir, {
    identicalEnglishAllowlist: [
      ...audit.identicalEnglishAllowlist,
      { ...audit.identicalEnglishAllowlist[0] },
    ],
  });
  assert.match(duplicateAllowance.violations.join("\n"), /duplicate_english_allowance:/);
});

test("고위험 exact fixture는 이동 요약 등 리뷰 사례의 값 변조를 거부한다", async () => {
  const { auditTask8Locales } = await import(pathToFileURL(auditPath));
  const result = auditTask8Locales(rootDir, {
    messageOverrides: {
      "en:reports:reports.daily.movementTitle": "Go Summary",
    },
  });
  assert.match(result.violations.join("\n"), /high_risk_copy:en:reports\.daily\.movementTitle/);
});

test("Task 8 Premium ID는 glossary 보호어를 직접 따르고 정본·번역값 변형을 거부한다", async () => {
  const glossary = JSON.parse(readFileSync(resolve(rootDir, "locales/glossary.json"), "utf8"));
  assert.equal(glossary.protectedTerms.includes("Premium"), true, "glossary가 exact Premium을 보호해야 합니다");

  for (const locale of ["en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"]) {
    const billing = catalog(locale, "billing");
    assert.equal(billing["billing.common.premium"], "Premium", `${locale}: Premium 보호어`);
    assert.equal(billing["billing.trialLock.title"], "Premium", `${locale}: TrialLock Premium 보호어`);
  }
  const koreanBilling = catalog("ko", "billing");
  assert.equal(koreanBilling["billing.common.premium"], "프리미엄");
  assert.equal(koreanBilling["billing.trialLock.title"], "프리미엄");

  const { auditTask8Locales } = await import(pathToFileURL(auditPath));
  const removedFromGlossary = auditTask8Locales(rootDir, {
    protectedTermsOverride: glossary.protectedTerms.filter((term) => term !== "Premium"),
  });
  assert.match(removedFromGlossary.violations.join("\n"), /protected_term_missing:Premium/);

  const changedInGlossary = auditTask8Locales(rootDir, {
    protectedTermsOverride: glossary.protectedTerms.map((term) => term === "Premium" ? "PREMIUM" : term),
  });
  assert.match(changedInGlossary.violations.join("\n"), /protected_term_missing:Premium/);

  const translatedTarget = auditTask8Locales(rootDir, {
    messageOverrides: {
      "ja:billing:billing.common.premium": "プレミアム",
    },
  });
  assert.match(translatedTarget.violations.join("\n"), /protected_term_copy:ja:billing\.common\.premium/);
});

test("locale 별 브랜드 표기는 A안 정본(고유명 Hyeni 유지 + 일반명사 현지화)을 따른다", () => {
  // 2026-08-25 TK 승인 A안. 음역(ヘニ·慧尼 …)은 채택하지 않았고, 캐릭터 이름 "혜니"의 음역과는 별개다.
  const expected = {
    ko: "혜니캘린더",
    en: "Hyeni Calendar",
    ja: "Hyeni カレンダー",
    "zh-CN": "Hyeni 日历",
    "zh-TW": "Hyeni 日曆",
    vi: "Lịch Hyeni",
    th: "ปฏิทิน Hyeni",
    id: "Kalender Hyeni",
    ms: "Kalendar Hyeni",
    fil: "Kalendaryo Hyeni",
  };
  const manifest = JSON.parse(readFileSync(resolve(rootDir, "locales/manifest.json"), "utf8"));
  const glossary = JSON.parse(readFileSync(resolve(rootDir, "locales/glossary.json"), "utf8"));
  assert.equal(manifest.locales.length, Object.keys(expected).length);
  for (const locale of manifest.locales) {
    const want = expected[locale.code];
    assert.ok(want, `manifest 에 예상 밖 locale: ${locale.code}`);
    assert.equal(locale.brandName, want, `manifest brandName: ${locale.code}`);
    assert.equal(glossary.brand[locale.code], want, `glossary brand: ${locale.code}`);
    assert.equal(catalog(locale.code, "core")["core.brand.name"], want, `core.brand.name: ${locale.code}`);
    // 모든 locale 브랜드는 고유명 Hyeni 를 그대로 포함해야 한다(한국어 고유 표기만 예외).
    if (locale.code !== "ko") assert.ok(want.includes("Hyeni"), `고유명 유지: ${locale.code}`);
  }
});

test("안심 리포트의 앱 사용·안전 상태는 주체와 의미를 바꾸지 않는다", () => {
  const expected = {
    ja: ["今日はお子さまが Hyeni カレンダー 以外のアプリを使った記録はありません。", "安全確認は良好です", "今日のお子さまの活動に、特別な危険の兆候はありません。"],
    "zh-CN": ["孩子今天没有使用 Hyeni 日历 以外的应用。", "安全检查结果良好", "今天孩子的活动中未发现异常安全信号。"],
    "zh-TW": ["孩子今天沒有使用 Hyeni 日曆 以外的應用程式。", "安全檢查結果良好", "今天孩子的活動中未發現異常安全訊號。"],
    vi: ["Hôm nay bé không dùng ứng dụng nào ngoài Lịch Hyeni.", "Các kiểm tra an toàn đều ổn", "Không phát hiện tín hiệu an toàn bất thường nào trong hoạt động của bé hôm nay."],
    th: ["วันนี้เด็กไม่ได้ใช้แอปอื่นนอกจาก ปฏิทิน Hyeni", "ผลการตรวจสอบความปลอดภัยปกติดี", "ไม่พบสัญญาณอันตรายผิดปกติในกิจกรรมของเด็กวันนี้"],
    id: ["Hari ini anak tidak menggunakan aplikasi lain selain Kalender Hyeni.", "Pemeriksaan keamanan berjalan baik", "Tidak ditemukan tanda bahaya yang tidak biasa dalam aktivitas anak hari ini."],
    ms: ["Hari ini anak tidak menggunakan aplikasi lain selain Kalendar Hyeni.", "Pemeriksaan keselamatan berjalan baik", "Tiada tanda keselamatan luar biasa dikesan dalam aktiviti anak hari ini."],
    fil: ["Hindi gumamit ang bata ng ibang app maliban sa Kalendaryo Hyeni ngayong araw.", "Maayos ang mga pagsusuri sa kaligtasan", "Walang nakitang kakaibang senyales ng panganib sa mga aktibidad ng bata ngayong araw."],
  };
  for (const [locale, values] of Object.entries(expected)) {
    const reports = catalog(locale, "reports");
    assert.equal(reports["reports.daily.noOtherApps"], values[0], `${locale}: 앱 사용 의미`);
    assert.equal(reports["reports.daily.status.safe.title"], values[1], `${locale}: 안전 상태 제목`);
    assert.equal(reports["reports.daily.status.safe.description"], values[2], `${locale}: 안전 상태 설명`);
  }
});

test("10개 locale의 안심 리포트 핵심 문구와 Premium 명칭은 부모 화면의 주체와 한국어 의미를 보존한다", () => {
  const expected = {
    ko: ["이동 요약", "혜니캘린더 외에 오늘 쓴 앱이 없어요.", "오늘 일정이 없어요.", "오늘 챙길 준비물이 없어요.", "안심 데이터 다시 시도", "프리미엄"],
    en: ["Movement summary", "Your child didn't use any apps other than Hyeni Calendar today.", "Your child has no events scheduled today.", "Your child has nothing to pack today.", "Retry safety report data", "Premium"],
    ja: ["移動のまとめ", "今日はお子さまが Hyeni カレンダー 以外のアプリを使った記録はありません。", "今日はお子さまの予定がありません。", "今日、お子さまが持っていくものはありません。", "安心レポートのデータを再読み込み", "Premium"],
    "zh-CN": ["移动摘要", "孩子今天没有使用 Hyeni 日历 以外的应用。", "孩子今天没有日程安排。", "孩子今天没有需要准备的物品。", "重试安心报告数据", "Premium"],
    "zh-TW": ["移動摘要", "孩子今天沒有使用 Hyeni 日曆 以外的應用程式。", "孩子今天沒有行程安排。", "孩子今天沒有需要準備的物品。", "重試安心報告資料", "Premium"],
    vi: ["Tóm tắt di chuyển", "Hôm nay bé không dùng ứng dụng nào ngoài Lịch Hyeni.", "Hôm nay bé không có lịch trình nào.", "Hôm nay bé không có đồ dùng nào cần chuẩn bị.", "Thử tải lại dữ liệu báo cáo an toàn", "Premium"],
    th: ["สรุปการเดินทาง", "วันนี้เด็กไม่ได้ใช้แอปอื่นนอกจาก ปฏิทิน Hyeni", "วันนี้เด็กไม่มีกำหนดการ", "วันนี้เด็กไม่มีของที่ต้องเตรียม", "ลองโหลดข้อมูลรายงานความปลอดภัยอีกครั้ง", "Premium"],
    id: ["Ringkasan pergerakan", "Hari ini anak tidak menggunakan aplikasi lain selain Kalender Hyeni.", "Anak tidak memiliki jadwal hari ini.", "Tidak ada perlengkapan yang perlu disiapkan anak hari ini.", "Coba lagi data laporan keamanan", "Premium"],
    ms: ["Ringkasan pergerakan", "Hari ini anak tidak menggunakan aplikasi lain selain Kalendar Hyeni.", "Anak tiada jadual hari ini.", "Tiada barang yang perlu disediakan untuk anak hari ini.", "Cuba semula data laporan keselamatan", "Premium"],
    fil: ["Buod ng paggalaw", "Hindi gumamit ang bata ng ibang app maliban sa Kalendaryo Hyeni ngayong araw.", "Walang iskedyul ang bata ngayong araw.", "Walang kailangang ihanda ang bata ngayong araw.", "Subukang muli ang data ng ulat sa kaligtasan", "Premium"],
  };

  for (const [locale, values] of Object.entries(expected)) {
    const reports = catalog(locale, "reports");
    const billing = catalog(locale, "billing");
    assert.equal(reports["reports.daily.movementTitle"], values[0], `${locale}: 이동 요약`);
    assert.equal(reports["reports.daily.noOtherApps"], values[1], `${locale}: 앱 사용 없음 주체`);
    assert.equal(reports["reports.daily.noScheduleToday"], values[2], `${locale}: 일정 없음 주체`);
    assert.equal(reports["reports.daily.noSuppliesToday"], values[3], `${locale}: 준비물 없음 주체`);
    assert.equal(reports["reports.daily.sourceRetryAria"], values[4], `${locale}: 안심 데이터 재시도 접근성 이름`);
    assert.equal(billing["billing.common.premium"], values[5], `${locale}: Premium 등급 이름`);
    assert.equal(billing["billing.trialLock.title"], values[5], `${locale}: TrialLock Premium 제목`);
  }
});
