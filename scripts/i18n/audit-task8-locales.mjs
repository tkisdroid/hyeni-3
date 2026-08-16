import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TASK8_BASELINE = "4fc8b55";
const TASK8_NAMESPACES = ["billing", "child", "notifications", "parent", "reports", "shared"];
const ALL_NAMESPACES = ["billing", "child", "core", "notifications", "onboarding", "parent", "reports", "shared"];

const identicalEnglishAllowlist = new Map([
  ["billing.aiCredit.providerPrice", "결제 공급자가 반환한 가격 변수 전용 메시지"],
  ["billing.aiCredit.serverCatalogPrice", "서버 가격 변수 전용 메시지"],
  ["billing.subscription.providerPrice", "결제 공급자가 반환한 가격 변수 전용 메시지"],
  ["billing.subscription.serverCatalogPrice", "서버 가격 변수 전용 메시지"],
  ["billing.subscription.provider.googlePlay", "Google Play 보호 상표"],
  ["billing.subscription.hero.title", "manifest 정본 브랜드와 Premium 보호 용어 조합"],
  ["billing.common.premium", "manifest glossary의 Premium 보호 용어"],
  ["billing.trialLock.title", "manifest glossary의 Premium 보호 용어"],
  ["child.aiSetup.personaSummary", "번역된 두 변수의 중립적 표시 순서"],
  ["child.aiPersona.panda.species", "각 locale에서 통용되는 panda 차용어"],
  ["child.home.hyeniAlt", "브랜드가 아닌 혜니 마스코트 고유 이름"],
  ["child.sos.title", "국제 긴급 신호 SOS 보호 용어"],
  ["shared.teacherReleaseGate.eyebrow", "manifest 정본 브랜드와 버전 변수만 표시"],
]);

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

const invalidBrandVariant = /(?:ヘニー?カレンダー|Hyeni(?:日历|日曆|カレンダー)|(?:Lịch|Kalender|Kalendar|Kalendaryong)\s+Hyeni|\bHyeni Premium\b)/u;

function readCatalog(rootDir, locale, namespace) {
  return JSON.parse(readFileSync(join(rootDir, "locales", locale, `${namespace}.json`), "utf8"));
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

export function auditTask8Locales(rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)))) {
  const manifest = JSON.parse(readFileSync(join(rootDir, "locales", "manifest.json"), "utf8"));
  const nonKoreanLocales = manifest.locales.filter(({ code }) => code !== "ko");
  const addedIds = task8MessageIds(rootDir);
  const violations = [];
  let auditedMessageCount = 0;

  for (const [namespace, ids] of addedIds) {
    const english = readCatalog(rootDir, "en", namespace);
    for (const { code: locale } of nonKoreanLocales) {
      const catalog = readCatalog(rootDir, locale, namespace);
      for (const id of ids) {
        auditedMessageCount += 1;
        const value = catalog[id];
        if (locale !== "en" && normalizeCopy(value) === normalizeCopy(english[id])) {
          if (!identicalEnglishAllowlist.has(id) && !isVariableOrTechnicalLayout(value)) {
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

  for (const namespace of ALL_NAMESPACES) {
    const korean = readCatalog(rootDir, "ko", namespace);
    for (const { code: locale, brandName } of nonKoreanLocales) {
      const catalog = readCatalog(rootDir, locale, namespace);
      for (const [id, value] of Object.entries(catalog)) {
        if (id === "billing.subscription.hero.title" && value !== `${brandName} Premium`) {
          violations.push(`brand_title:${locale}:${id}:${value}`);
        }
        if (invalidBrandVariant.test(value)) violations.push(`brand_variant:${locale}:${id}:${value}`);
        if (korean[id]?.includes("혜니캘린더") && !value.includes(brandName)) {
          violations.push(`brand_missing:${locale}:${id}:${brandName}`);
        }
      }
    }
  }

  return { auditedMessageCount, violations: [...new Set(violations)].sort() };
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
