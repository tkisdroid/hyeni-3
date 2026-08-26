import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createIntl, createIntlCache } from "react-intl";
import { localizedBrandName } from "../src/i18n/locale.ts";

const readCatalog = (locale, namespace) => JSON.parse(readFileSync(
  new URL(`../locales/${locale}/${namespace}.json`, import.meta.url),
  "utf8",
));
const foreignLocales = ["en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const allLocales = ["ko", ...foreignLocales];

function formatParent(locale, id, values) {
  const messages = readCatalog(locale, "parent");
  assert.equal(typeof messages[id], "string", `${locale}:${id}: 메시지 누락`);
  return createIntl({ locale, messages }, createIntlCache()).formatMessage({ id }, values);
}

test("브랜드·pair placeholder·login ID·보호자 코드의 핵심 의미를 훼손하지 않는다", () => {
  for (const locale of foreignLocales) {
    const onboarding = readCatalog(locale, "onboarding");
    const core = readCatalog(locale, "core");
    const combined = JSON.stringify({ core, onboarding });
    assert.match(combined, /Hyeni/, `${locale}: Hyeni 브랜드 누락`);
    assert.equal(core["core.brand.name"], localizedBrandName(locale), `${locale}: 브랜드 이름`);
    // rich 표기는 일반명사 부분만 강조한다 — 태그를 벗기면 정본 브랜드와 같아야 한다.
    assert.equal(
      core["core.brand.nameRich"].replaceAll(/<\/?strong>/g, ""),
      localizedBrandName(locale),
      `${locale}: rich 브랜드 이름`,
    );
    // 위치 고지는 어느 언어에서도 그 언어의 브랜드로 수집 주체를 밝혀야 한다.
    assert.ok(
      readCatalog(locale, "shared")["shared.locationPermission.disclosure.collection.formal"]
        .includes(localizedBrandName(locale)),
      `${locale}: 위치 고지 브랜드`,
    );
    assert.doesNotMatch(combined, /鬣狗|父代码|父代碼|身份证件|身分證件|mã gốc|Nama belakang/, `${locale}: 금지 오역`);
    assert.match(onboarding["onboarding.pairing.invalidCode"], /KID-XXXXXXXX/, `${locale}: 연결 코드 예시`);
    assert.equal((onboarding["onboarding.pairing.invalidCode"].match(/X/g) ?? []).length, 8, `${locale}: X 8개`);
  }
});

test("아이용 위치·오류 문구는 locale별 formal 호칭을 섞지 않는다", () => {
  const forbidden = {
    ja: /ください|です|ます/,
    "zh-CN": /您/,
    "zh-TW": /您/,
    vi: /Vui lòng/i,
    th: /กรุณา|โปรด|คุณ/,
    id: /Silakan|Anda/,
    ms: /\bSila\b|\banda\b/i,
    fil: /Mangyaring|Paki(?:suri|lagay|subukan)/i,
  };
  const childContext = (id) => id.endsWith(".child")
    || id.includes(".child.")
    || id.endsWith(".childDescription")
    || /^onboarding\.permissions\.(?:background|location|notifications)\.childDescription$/.test(id)
    || /^onboarding\.permissions\.(?:subtitle|title)\.child$/.test(id)
    || /^onboarding\.role\.child\./.test(id);
  for (const [locale, pattern] of Object.entries(forbidden)) {
    const catalog = {
      ...readCatalog(locale, "core"),
      ...readCatalog(locale, "onboarding"),
      ...readCatalog(locale, "shared"),
    };
    for (const [id, value] of Object.entries(catalog)) {
      if (childContext(id)) assert.doesNotMatch(value, pattern, `${locale}:${id}`);
    }
  }
});

test("가족 대화의 child와 parent 문구는 모든 locale에서 별도 key와 톤을 유지한다", () => {
  const pairs = [
    ["shared.memo.copy.empty.child", "shared.memo.copy.empty.formal"],
    ["shared.memo.copy.inputPlaceholder.child", "shared.memo.copy.inputPlaceholder.formal"],
    ["shared.memo.copy.sendFailed.child", "shared.memo.copy.sendFailed.formal"],
    ["shared.memo.photo.error.child", "shared.memo.photo.error.formal"],
  ];
  for (const locale of foreignLocales) {
    const shared = readCatalog(locale, "shared");
    for (const [childId, formalId] of pairs) {
      assert.equal(typeof shared[childId], "string", `${locale}:${childId}`);
      assert.equal(typeof shared[formalId], "string", `${locale}:${formalId}`);
      assert.notEqual(shared[childId], shared[formalId], `${locale}: child/formal 문구가 같으면 안 됩니다`);
    }
  }
});

test("중국 본토와 대만 catalog는 지역별 연결·위치 용어를 분리한다", () => {
  const cn = readCatalog("zh-CN", "onboarding");
  const tw = readCatalog("zh-TW", "onboarding");
  assert.match(cn["onboarding.pairing.codeLabel"], /连接码/);
  assert.match(tw["onboarding.pairing.codeLabel"], /連結碼/);
  assert.match(cn["onboarding.permissions.location.title"], /位置信息/);
  assert.match(tw["onboarding.permissions.location.title"], /位置資訊/);
  assert.doesNotMatch(JSON.stringify(tw), /连接|验证码|设置信息|尝试/);
});

test("비한국어 core·onboarding·shared는 native 검수 완료로 올리지 않고 draft를 유지한다", () => {
  const status = JSON.parse(readFileSync(new URL("../locales/review-status.json", import.meta.url), "utf8"));
  for (const locale of foreignLocales) {
    for (const namespace of ["core", "onboarding", "shared"]) {
      assert.equal(status.statuses[locale][namespace], "draft", `${locale}:${namespace}`);
    }
  }
});

test("중국어 아이 권한 문구는 존칭을 쓰지 않고 Indonesian 보호자는 사람 역할로 표현한다", () => {
  for (const locale of ["zh-CN", "zh-TW"]) {
    // 위치 권한 고지는 shared 로 옮겼으므로 두 namespace 를 함께 본다.
    const catalog = { ...readCatalog(locale, "onboarding"), ...readCatalog(locale, "shared") };
    for (const [id, value] of Object.entries(catalog)) {
      if (/^shared\.locationPermission\..*\.child$/.test(id)
        || /permissions\.(?:background|location|notifications)\.child|permissions\.(?:subtitle|title)\.child/.test(id)) {
        assert.doesNotMatch(value, /您/, `${locale}:${id}`);
      }
    }
  }
  const id = readCatalog("id", "onboarding");
  assert.doesNotMatch(id["onboarding.pairing.title"], /\binduk\b/i);
  assert.doesNotMatch(id["onboarding.pairing.description"], /\binduk\b/i);
  assert.equal(id["onboarding.role.parent.title"], "Orang tua");

  const th = readCatalog("th", "onboarding");
  assert.equal(th["onboarding.field.loginId"], "ID เข้าสู่ระบบ");
  assert.match(th["onboarding.validation.loginIdRequired"], /ID เข้าสู่ระบบ/);
});

test("Malay 아이 core 문구는 formal Sila를 사용하지 않는다", () => {
  const core = readCatalog("ms", "core");
  for (const [id, value] of Object.entries(core)) {
    if (id.endsWith(".child") || id.includes(".child.")) {
      assert.doesNotMatch(value, /\bSila\b/i, id);
    }
  }
});

test("부모 홈 일정 수와 반복 수정 안내는 count를 포함한 완전한 ICU 문장으로 포맷한다", () => {
  const expectedCount = {
    ko: "3개",
    en: "3 events",
    ja: "3件",
    "zh-CN": "3个日程",
    "zh-TW": "3個行程",
    vi: "3 lịch trình",
    th: "3 รายการ",
    id: "3 jadwal",
    ms: "3 jadual",
    fil: "3 iskedyul",
  };
  const expectedRepeat = {
    ko: "같은 반복으로 이어지는 이후 일정 3개가 있어요. 수정 범위를 선택해 주세요.",
    en: "There are 3 future events in this series. Choose which events to update.",
    ja: "同じ繰り返しの今後の予定が3件あります。変更する範囲を選んでください。",
    "zh-CN": "同一重复系列中还有3个后续日程。请选择要修改的范围。",
    "zh-TW": "同一重複系列中還有3個後續行程。請選擇要修改的範圍。",
    vi: "Có 3 lịch trình sắp tới trong chuỗi lặp này. Hãy chọn phạm vi cần sửa.",
    th: "มีอีก 3 รายการในชุดกิจกรรมที่เกิดซ้ำนี้ โปรดเลือกช่วงที่ต้องการแก้ไข",
    id: "Ada 3 jadwal mendatang dalam rangkaian berulang ini. Pilih cakupan yang ingin diubah.",
    ms: "Terdapat 3 jadual akan datang dalam siri berulang ini. Pilih julat yang mahu diubah.",
    fil: "May 3 paparating na iskedyul sa umuulit na seryeng ito. Piliin ang saklaw na babaguhin.",
  };

  for (const locale of allLocales) {
    assert.equal(formatParent(locale, "parent.home.todayEventCount", { count: 3 }), expectedCount[locale], locale);
    assert.equal(formatParent(locale, "parent.eventForm.repeatFutureNotice", { count: 3 }), expectedRepeat[locale], locale);
  }
});

test("폐기한 일정 문장 조각과 동물 오역은 정본·설명·생성 inventory에 남지 않는다", () => {
  const removedIds = [
    "parent.parentHome.copy013",
    "parent.eventForm.copy068",
    "parent.eventForm.copy069",
  ];
  const descriptions = JSON.parse(readFileSync(new URL("../locales/descriptions.json", import.meta.url), "utf8"));
  const messageIds = readFileSync(new URL("../src/i18n/generated/messageIds.ts", import.meta.url), "utf8");
  const animalPollution = /\bdog\b|犬|狗|\bchó\b|สุนัข|\banjing\b|\baso\b/i;

  for (const locale of allLocales) {
    const source = readCatalog(locale, "parent");
    const generated = readFileSync(new URL(`../src/i18n/generated/catalogs/${locale}/parent.ts`, import.meta.url), "utf8");
    for (const id of removedIds) {
      assert.equal(Object.hasOwn(source, id), false, `${locale}:${id}: locale 정본에서 제거`);
      assert.doesNotMatch(generated, new RegExp(id.replaceAll(".", "\\.")), `${locale}:${id}: 생성 catalog에서 제거`);
    }
    assert.doesNotMatch(JSON.stringify(source), animalPollution, `${locale}: locale 정본 동물 오역`);
    assert.doesNotMatch(generated, animalPollution, `${locale}: 생성 catalog 동물 오역`);
  }
  for (const id of removedIds) {
    assert.equal(Object.hasOwn(descriptions, id), false, `${id}: descriptions에서 제거`);
    assert.doesNotMatch(messageIds, new RegExp(id.replaceAll(".", "\\.")), `${id}: message inventory에서 제거`);
  }
});

test("영어 반복 일정 안내는 0·1·2·3 경계에서 문장 전체의 수와 문법을 맞춘다", () => {
  const expected = {
    0: "There are 0 future events in this series. Choose which events to update.",
    1: "There is 1 future event in this series. Choose which event to update.",
    2: "There are 2 future events in this series. Choose which events to update.",
    3: "There are 3 future events in this series. Choose which events to update.",
  };
  for (const [count, sentence] of Object.entries(expected)) {
    assert.equal(formatParent("en", "parent.eventForm.repeatFutureNotice", { count: Number(count) }), sentence);
  }
});

test("반복 일정 안내는 10개 locale에서 count placeholder와 실제 숫자를 보존한다", () => {
  for (const locale of allLocales) {
    const source = readCatalog(locale, "parent")["parent.eventForm.repeatFutureNotice"];
    assert.match(source, /\{count(?:,|\})/, `${locale}: count placeholder`);
    for (const count of [0, 1, 2, 3]) {
      const sentence = formatParent(locale, "parent.eventForm.repeatFutureNotice", { count });
      assert.match(sentence, new RegExp(String(count)), `${locale}:${count}: 숫자 보존`);
      assert.doesNotMatch(sentence, /\{count|\}/, `${locale}:${count}: ICU 잔재`);
      assert.ok(sentence.trim().length > String(count).length + 12, `${locale}:${count}: 완전한 안내 문장`);
    }
  }
});

test("비한국어 referral과 위치 서비스 문구는 공통 브랜드 정본을 그대로 쓴다", () => {
  const brandMessageIds = [
    "parent.settings.version",
    "parent.parentHome.copy046",
    "parent.parentSettings.copy025",
    "parent.referralRewardPanel.copy004",
    "parent.referralRewardPanel.shareBody",
    "parent.device.location.serviceStoppedDetail",
  ];
  for (const locale of foreignLocales) {
    const brand = localizedBrandName(locale);
    assert.ok(brand.includes("Hyeni"), `${locale}: 공통 브랜드 정본에 고유명 Hyeni 유지`);
    const parent = readCatalog(locale, "parent");
    for (const id of brandMessageIds) {
      assert.match(parent[id], new RegExp(brand), `${locale}:${id}`);
    }
  }
});

test("7일 체험 CTA는 localized CTA를 포함한 locale별 완전한 문장이다", () => {
  const expected = {
    ko: "7일 무료로 UPGRADE",
    en: "Try UPGRADE free for 7 days",
    ja: "UPGRADEを7日間無料で試す",
    "zh-CN": "免费试用UPGRADE 7天",
    "zh-TW": "免費試用UPGRADE 7天",
    vi: "Dùng thử UPGRADE miễn phí trong 7 ngày",
    th: "ลองใช้ UPGRADE ฟรี 7 วัน",
    id: "Coba UPGRADE gratis selama 7 hari",
    ms: "Cuba UPGRADE secara percuma selama 7 hari",
    fil: "Subukan ang UPGRADE nang libre sa loob ng 7 araw",
  };
  for (const locale of allLocales) {
    assert.equal(formatParent(locale, "parent.premiumUpsell.trialCta", { cta: "UPGRADE" }), expected[locale], locale);
  }
});

test("QR·추천 크레딧·주변소리·준비물의 고위험 의미를 locale별 실제 문구로 보존한다", () => {
  const qr = {
    ko: "가족 역할 선택 QR 코드",
    en: "Family role-selection QR code",
    ja: "家族の役割選択QRコード",
    "zh-CN": "家庭角色选择二维码",
    "zh-TW": "家庭角色選擇 QR 碼",
    vi: "Mã QR chọn vai trò gia đình",
    th: "คิวอาร์โค้ดเลือกบทบาทครอบครัว",
    id: "Kode QR pemilihan peran keluarga",
    ms: "Kod QR pilihan peranan keluarga",
    fil: "QR code para sa pagpili ng role sa pamilya",
  };
  const supplies = {
    ko: "예) 실내화, 물통 (쉼표로 여러 개)",
    en: "e.g. indoor shoes, water bottle (separate multiple items with commas)",
    ja: "例）上履き、水筒（複数はカンマ区切り）",
    "zh-CN": "例如：室内鞋、水壶（多个物品请用逗号分隔）",
    "zh-TW": "例如：室內鞋、水壺（多個物品請用逗號分隔）",
    vi: "Ví dụ: giày đi trong nhà, bình nước (ngăn cách nhiều món bằng dấu phẩy)",
    th: "เช่น รองเท้าสำหรับใส่ในอาคาร, กระบอกน้ำ (คั่นหลายรายการด้วยจุลภาค)",
    id: "Contoh: sepatu dalam ruangan, botol minum (pisahkan beberapa barang dengan koma)",
    ms: "Contoh: kasut dalam bangunan, botol air (pisahkan beberapa barang dengan koma)",
    fil: "Hal. panloob na sapatos, bote ng tubig (paghiwalayin ang maraming gamit gamit ang kuwit)",
  };

  for (const locale of allLocales) {
    const parent = readCatalog(locale, "parent");
    assert.equal(parent["parent.parentFamily.copy018"], qr[locale], `${locale}: 가족 역할 선택 QR`);
    assert.equal(parent["parent.eventForm.copy056"], supplies[locale], `${locale}: 준비물 예시`);
    if (locale !== "ko") {
      // 단계 설명(copy013)은 2026-08-17에 없어졌다 — 남은 지급 조건 문구로 같은 오인을 막는다.
      assert.doesNotMatch(parent["parent.referralRewardPanel.copy010"], /\bpays?\b|현금|cash/i, `${locale}: 추천 보상을 현금 지급으로 오해하면 안 됩니다`);
    }
  }

  assert.equal(readCatalog("zh-CN", "parent")["parent.upsell.remote_audio.ctaLabel"], "使用Premium听取周围声音");
  assert.equal(readCatalog("zh-TW", "parent")["parent.upsell.remote_audio.ctaLabel"], "使用 Premium 聽取周圍聲音");
});

test("한국어 자녀 삭제 toast는 이름 받침에 맞는 목적격 조사를 사용한다", () => {
  const childDetail = readFileSync(new URL("../src/screens/parent/ChildDetail.tsx", import.meta.url), "utf8");
  const ko = readCatalog("ko", "parent");
  assert.equal(ko["parent.childDetail.removedFromFamily"], "{target} 가족에서 삭제했어요");
  assert.match(childDetail, /hasJongseong\(name\)/);
  assert.match(childDetail, /target:\s*locale === "ko"\s*\? `\$\{name\}\$\{hasJongseong\(name\) \? "을" : "를"\}`\s*:\s*name/);
});
