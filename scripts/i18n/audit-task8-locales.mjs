import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TASK8_BASELINE = "4fc8b55";
const TASK8_NAMESPACES = ["billing", "child", "notifications", "parent", "reports", "shared"];
const ALL_NAMESPACES = ["billing", "child", "core", "notifications", "onboarding", "parent", "reports", "shared"];

function exactAllowances(locales, id, value, reason) {
  return locales.map((locale) => ({ locale, id, value, reason }));
}

const ALL_NON_KOREAN_NON_ENGLISH = ["ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

export const identicalEnglishAllowlist = Object.freeze([
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "parent.socialLinks.provider.google",
    "Google",
    "Google 보호 상표는 번역하지 않습니다.",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "parent.socialLinks.provider.kakao",
    "Kakao",
    "Kakao 로그인 제공자의 공식 라틴 표기입니다(한국어만 카카오).",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "parent.socialLinks.provider.naver",
    "Naver",
    "Naver 로그인 제공자의 공식 라틴 표기입니다(한국어만 네이버).",
  ),
  ...exactAllowances(
    ["ja", "vi", "th", "id", "ms", "fil"],
    "shared.device.manufacturer.samsung",
    "Samsung {model}",
    "Samsung 제조사 표기는 해당 locale 에서 라틴 상표를 그대로 씁니다(한국어 삼성·중국어 三星만 현지 표기).",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "parent.home.heroSlide.study.eyebrow",
    "Hyeni Study",
    "히어로 소식 슬라이드가 여는 사이드 프로젝트(hyenistudy.com)의 워드마크입니다. 다른 서비스의 이름을 임의로 현지화하지 않습니다.",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "parent.home.heroSlide.world.eyebrow",
    "Hyeni World",
    "히어로 소식 슬라이드가 여는 유튜브 채널(@hyeniworld)의 워드마크입니다. 다른 서비스의 이름을 임의로 현지화하지 않습니다.",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "billing.subscription.provider.googlePlay",
    "Google Play",
    "Google Play 보호 상표는 번역하지 않습니다.",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "billing.common.premium",
    "Premium",
    "해당 locale에서 제품 등급명 Premium을 고유 명칭으로 유지합니다.",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "billing.trialLock.title",
    "Premium",
    "해당 locale에서 제품 등급명 Premium을 고유 명칭으로 유지합니다.",
  ),
  ...exactAllowances(
    ["id", "ms", "fil"],
    "child.aiPersona.panda.species",
    "panda",
    "해당 locale에서 panda 차용어 표기가 영어와 같습니다.",
  ),
  ...exactAllowances(
    ["zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"],
    "child.home.hyeniAlt",
    "Hyeni",
    "혜니 마스코트의 고유 이름 대체 텍스트입니다.",
  ),
  ...exactAllowances(
    ALL_NON_KOREAN_NON_ENGLISH,
    "child.sos.title",
    "SOS",
    "국제 긴급 신호 SOS 표기를 유지합니다.",
  ),
  // `shared.teacherReleaseGate.eyebrow` 는 A안 이후 locale 마다 브랜드가 달라 영어 동일값이 아니다.
  // 브랜드 포함 여부는 `brand_missing`·`brand_foreign` 검사가 담당한다.
]);

const highRiskExactMessages = [
  {
    namespace: "reports",
    id: "reports.daily.movementTitle",
    values: {
      ko: "이동 요약", en: "Movement summary", ja: "移動のまとめ", "zh-CN": "移动摘要", "zh-TW": "移動摘要",
      vi: "Tóm tắt di chuyển", th: "สรุปการเดินทาง", id: "Ringkasan pergerakan", ms: "Ringkasan pergerakan", fil: "Buod ng paggalaw",
    },
  },
  {
    namespace: "reports",
    id: "reports.daily.noOtherApps",
    values: {
      ko: "혜니캘린더 외에 오늘 쓴 앱이 없어요.", en: "Your child didn't use any apps other than Hyeni Calendar today.",
      ja: "今日はお子さまが Hyeni カレンダー 以外のアプリを使った記録はありません。", "zh-CN": "孩子今天没有使用 Hyeni 日历 以外的应用。",
      "zh-TW": "孩子今天沒有使用 Hyeni 日曆 以外的應用程式。", vi: "Hôm nay bé không dùng ứng dụng nào ngoài Lịch Hyeni.",
      th: "วันนี้เด็กไม่ได้ใช้แอปอื่นนอกจาก ปฏิทิน Hyeni", id: "Hari ini anak tidak menggunakan aplikasi lain selain Kalender Hyeni.",
      ms: "Hari ini anak tidak menggunakan aplikasi lain selain Kalendar Hyeni.", fil: "Hindi gumamit ang bata ng ibang app maliban sa Kalendaryo Hyeni ngayong araw.",
    },
  },
  {
    namespace: "reports",
    id: "reports.daily.noScheduleToday",
    values: {
      ko: "오늘 일정이 없어요.", en: "Your child has no events scheduled today.", ja: "今日はお子さまの予定がありません。",
      "zh-CN": "孩子今天没有日程安排。", "zh-TW": "孩子今天沒有行程安排。", vi: "Hôm nay bé không có lịch trình nào.",
      th: "วันนี้เด็กไม่มีกำหนดการ", id: "Anak tidak memiliki jadwal hari ini.", ms: "Anak tiada jadual hari ini.", fil: "Walang iskedyul ang bata ngayong araw.",
    },
  },
  {
    namespace: "reports",
    id: "reports.daily.noSuppliesToday",
    values: {
      ko: "오늘 챙길 준비물이 없어요.", en: "Your child has nothing to pack today.", ja: "今日、お子さまが持っていくものはありません。",
      "zh-CN": "孩子今天没有需要准备的物品。", "zh-TW": "孩子今天沒有需要準備的物品。", vi: "Hôm nay bé không có đồ dùng nào cần chuẩn bị.",
      th: "วันนี้เด็กไม่มีของที่ต้องเตรียม", id: "Tidak ada perlengkapan yang perlu disiapkan anak hari ini.",
      ms: "Tiada barang yang perlu disediakan untuk anak hari ini.", fil: "Walang kailangang ihanda ang bata ngayong araw.",
    },
  },
  {
    namespace: "reports",
    id: "reports.daily.sourceRetryAria",
    values: {
      ko: "안심 데이터 다시 시도", en: "Retry safety report data", ja: "安心レポートのデータを再読み込み",
      "zh-CN": "重试安心报告数据", "zh-TW": "重試安心報告資料", vi: "Thử tải lại dữ liệu báo cáo an toàn",
      th: "ลองโหลดข้อมูลรายงานความปลอดภัยอีกครั้ง", id: "Coba lagi data laporan keamanan",
      ms: "Cuba semula data laporan keselamatan", fil: "Subukang muli ang data ng ulat sa kaligtasan",
    },
  },
  {
    namespace: "billing",
    id: "billing.common.premium",
    values: {
      ko: "프리미엄", en: "Premium", ja: "Premium", "zh-CN": "Premium", "zh-TW": "Premium",
      vi: "Premium", th: "Premium", id: "Premium", ms: "Premium", fil: "Premium",
    },
  },
  {
    namespace: "billing",
    id: "billing.trialLock.title",
    values: {
      ko: "프리미엄", en: "Premium", ja: "Premium", "zh-CN": "Premium", "zh-TW": "Premium",
      vi: "Premium", th: "Premium", id: "Premium", ms: "Premium", fil: "Premium",
    },
  },
];

const simplifiedToTraditional = new Map(Object.entries({
  "仅": "僅", "听": "聽", "后": "後", "会": "會", "钟": "鐘", "离": "離", "开": "開",
  "败": "敗", "标": "標", "时": "時", "无": "無", "须": "須", "点": "點", "击": "擊",
  "间": "間", "这": "這", "还": "還", "为": "為", "与": "與", "个": "個", "发": "發",
  "关": "關", "线": "線", "网": "網", "应": "應", "选": "選", "项": "項", "设": "設",
  "认": "認", "确": "確", "检": "檢", "连": "連", "阅": "閱", "权": "權", "览": "覽",
  "账": "帳", "务": "務", "录": "錄", "请": "請", "响": "響", "区": "區", "实": "實",
  "历": "歷", "报": "報", "边": "邊", "过": "過", "门": "門", "见": "見", "显": "顯",
  "从": "從", "将": "將", "种": "種", "进": "進", "远": "遠", "处": "處", "让": "讓",
  "话": "話", "说": "說", "该": "該", "对": "對", "给": "給", "带": "帶", "则": "則",
  "级": "級", "术": "術", "价": "價", "儿": "兒", "买": "買", "卖": "賣", "东": "東",
  "书": "書", "车": "車", "总": "總", "长": "長", "场": "場", "气": "氣", "达": "達",
  "备": "備", "启": "啟", "员": "員", "据": "據", "险": "險", "围": "圍", "载": "載",
  "谁": "誰", "于": "於", "并": "並", "断": "斷", "传": "傳", "储": "儲", "复": "復",
  "号": "號", "码": "碼", "条": "條", "页": "頁", "迟": "遲", "积": "積", "额": "額",
  "视": "視", "软": "軟", "户": "戶", "续": "續", "调": "調", "释": "釋",
}));

const simplifiedPhrases = new Map([
  ["屏幕", "螢幕"],
  ["刷新", "重新整理"],
  ["信息", "資訊"],
]);

/**
 * 승인되지 않은 브랜드 표기만 차단한다(2026-08-25 TK 승인 A안).
 *
 * A안 = 고유명 `Hyeni` 를 유지하고 "캘린더"에 해당하는 일반명사만 현지어로 쓴다.
 * 따라서 `Hyeni カレンダー`·`Hyeni 日历`·`Lịch Hyeni`·`Kalender Hyeni` 같은 정본 표기는 정상이다.
 *
 * ⚠️ 캐릭터 이름 "혜니"의 음역(`ヘニ`·`惠妮`)은 **브랜드가 아니라 AI 친구 이름**이라 이미 각 locale 에
 * 승인돼 있다(`child.aiPersona.*.greeting`·`child.home.hyeniAlt`). 여기서 음역을 막으면 캐릭터가 깨진다.
 * `Hyeni Premium` 도 `Kalendaryo Hyeni Premium` 처럼 정본 조합의 부분 문자열이므로 막을 수 없다.
 *
 * 그래서 A안 강제는 아래 세 검사가 담당한다.
 *  - `brand_title`  : `billing.subscription.hero.title` === `${brandName} Premium`
 *  - `brand_missing`: ko 에 브랜드가 든 id 는 해당 locale 브랜드를 반드시 포함
 *  - `brand_foreign`: 자기 것이 아닌 다른 locale 브랜드 혼입 금지
 * 이 정규식은 그 셋으로 잡히지 않는 **철자 오류**만 남긴다.
 */
const invalidBrandVariant = /(?:Kalendaryong\s+Hyeni|Hyeni\s+Calender|Hyeni\s+Kalender)/u;

function readCatalog(rootDir, locale, namespace) {
  return JSON.parse(readFileSync(join(rootDir, "locales", locale, `${namespace}.json`), "utf8"));
}

function readMessage(catalog, locale, namespace, id, messageOverrides) {
  const overrideKey = `${locale}:${namespace}:${id}`;
  return Object.hasOwn(messageOverrides, overrideKey) ? messageOverrides[overrideKey] : catalog[id];
}

function allowanceKey({ locale, id, value }) {
  return `${locale}\u0000${id}\u0000${value}`;
}

function readBaselineCatalog(rootDir, namespace) {
  return JSON.parse(execFileSync(
    "git",
    ["-C", rootDir, "show", `${TASK8_BASELINE}:locales/ko/${namespace}.json`],
    { encoding: "utf8" },
  ));
}

export function normalizeCopy(value) {
  return value
    .normalize("NFKC")
    .replace(/[“”„]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function isVariableOrTechnicalLayout(value) {
  const withoutSimpleVariables = value.replace(/\{[A-Za-z][^{}]*\}/gu, "");
  return !/[\p{L}\p{N}]/u.test(withoutSimpleVariables)
    || /^[\s·.,:()\-/+]*m[\s·.,:()\-/+]*$/iu.test(withoutSimpleVariables)
    || /^0\d{2}-\d{4}-\d{4}$/u.test(value);
}

function task8MessageIds(rootDir) {
  const result = new Map();
  for (const namespace of TASK8_NAMESPACES) {
    const baseline = readBaselineCatalog(rootDir, namespace);
    const current = readCatalog(rootDir, "ko", namespace);
    result.set(namespace, Object.keys(current).filter((id) => !(id in baseline)));
  }
  return result;
}

export function auditTask8Locales(
  rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  options = {},
) {
  const messageOverrides = options.messageOverrides ?? {};
  const allowanceEntries = options.identicalEnglishAllowlist ?? identicalEnglishAllowlist;
  const manifest = JSON.parse(readFileSync(join(rootDir, "locales", "manifest.json"), "utf8"));
  const glossary = JSON.parse(readFileSync(join(rootDir, "locales", "glossary.json"), "utf8"));
  const protectedTerms = options.protectedTermsOverride ?? glossary.protectedTerms;
  const nonKoreanLocales = manifest.locales.filter(({ code }) => code !== "ko");
  const addedIds = task8MessageIds(rootDir);
  const violations = [];
  if (!Array.isArray(protectedTerms) || !protectedTerms.includes("Premium")) {
    violations.push("protected_term_missing:Premium");
  }
  const allowanceLookup = new Map();
  for (const entry of allowanceEntries) {
    const key = allowanceKey(entry);
    if (allowanceLookup.has(key)) {
      violations.push(`duplicate_english_allowance:${entry.locale}:${entry.id}:${entry.value}`);
    } else {
      allowanceLookup.set(key, entry);
    }
  }
  const consumedAllowances = new Set();
  let auditedMessageCount = 0;

  for (const [namespace, ids] of addedIds) {
    const english = readCatalog(rootDir, "en", namespace);
    for (const { code: locale } of nonKoreanLocales) {
      const catalog = readCatalog(rootDir, locale, namespace);
      for (const id of ids) {
        auditedMessageCount += 1;
        const value = readMessage(catalog, locale, namespace, id, messageOverrides);
        const englishValue = readMessage(english, "en", namespace, id, messageOverrides);
        if (locale !== "en" && normalizeCopy(value) === normalizeCopy(englishValue)) {
          const exactAllowanceKey = allowanceKey({ locale, id, value });
          if (allowanceLookup.has(exactAllowanceKey)) {
            consumedAllowances.add(exactAllowanceKey);
          } else if (!isVariableOrTechnicalLayout(value)) {
            violations.push(`english_fallback:${locale}:${id}:${value}`);
          }
        }
        if (locale === "zh-TW") {
          const mixed = [...simplifiedToTraditional].filter(([char]) => value.includes(char));
          if (mixed.length > 0) {
            violations.push(`zh_tw_script:${id}:${mixed.map(([from, to]) => `${from}→${to}`).join(",")}`);
          }
          const mixedPhrases = [...simplifiedPhrases].filter(([phrase]) => value.includes(phrase));
          if (mixedPhrases.length > 0) {
            violations.push(`zh_tw_wording:${id}:${mixedPhrases.map(([from, to]) => `${from}→${to}`).join(",")}`);
          }
        }
      }
    }
  }

  for (const entry of allowanceEntries) {
    const key = allowanceKey(entry);
    if (!consumedAllowances.has(key)) {
      violations.push(`stale_english_allowance:${entry.locale}:${entry.id}:${entry.value}`);
    }
  }

  for (const { namespace, id, values } of highRiskExactMessages) {
    for (const { code: locale } of manifest.locales) {
      const catalog = readCatalog(rootDir, locale, namespace);
      const value = readMessage(catalog, locale, namespace, id, messageOverrides);
      if (value !== values[locale]) {
        violations.push(`high_risk_copy:${locale}:${id}:${value}`);
      }
    }
  }

  for (const { code: locale } of nonKoreanLocales) {
    const billing = readCatalog(rootDir, locale, "billing");
    for (const id of ["billing.common.premium", "billing.trialLock.title"]) {
      const value = readMessage(billing, locale, "billing", id, messageOverrides);
      if (value !== "Premium") violations.push(`protected_term_copy:${locale}:${id}:${value}`);
    }
  }

  for (const namespace of ALL_NAMESPACES) {
    const korean = readCatalog(rootDir, "ko", namespace);
    for (const { code: locale, brandName } of nonKoreanLocales) {
      // A안에서는 locale 마다 브랜드 표기가 다르므로, 자기 것이 아닌 다른 locale 브랜드가 섞이면 위반이다.
      // (예: 일본어 문구에 영어 `Hyeni Calendar` 가 남아 있는 경우)
      const foreignBrands = manifest.locales
        .filter(({ code }) => code !== locale && code !== "ko")
        .map(({ brandName: other }) => other)
        .filter((other) => typeof other === "string" && other.length > 0 && !brandName.includes(other));
      const catalog = readCatalog(rootDir, locale, namespace);
      for (const id of Object.keys(catalog)) {
        const value = readMessage(catalog, locale, namespace, id, messageOverrides);
        if (id === "billing.subscription.hero.title" && value !== `${brandName} Premium`) {
          violations.push(`brand_title:${locale}:${id}:${value}`);
        }
        if (invalidBrandVariant.test(value)) violations.push(`brand_variant:${locale}:${id}:${value}`);
        if (korean[id]?.includes("혜니캘린더") && !value.includes(brandName)) {
          violations.push(`brand_missing:${locale}:${id}:${brandName}`);
        }
        if (typeof value === "string") {
          const foreign = foreignBrands.find((other) => value.includes(other));
          if (foreign) violations.push(`brand_foreign:${locale}:${id}:${foreign}`);
        }
      }
    }
  }

  return {
    auditedMessageCount,
    allowlistEntries: allowanceEntries.length,
    consumedAllowlistEntries: consumedAllowances.size,
    violations: [...new Set(violations)].sort(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = auditTask8Locales(process.cwd());
  if (result.violations.length > 0) {
    console.error(result.violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Task 8 locale ${result.auditedMessageCount}개 감사 완료`);
  }
}
