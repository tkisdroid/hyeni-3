/**
 * Play 10-locale listing pack 생성·검증.
 *
 * 정본은 `store/global/source/ko-KR.json` 이고, 여기서
 * `store/global/locales/<listingLocale>/listing.json` 을 만든다.
 *
 * 왜 번역 상태를 파일에 남기는가
 *  - Play listing 은 Tier B 콘텐츠다. 원어민 검수 evidence 없이 `approved` 로 올리면
 *    스토어에 검증되지 않은 문구가 그대로 공개된다.
 *  - 그래서 각 locale 은 `translationStatus` 를 갖고, 아직 번역되지 않은 필드는
 *    한국어를 복사해 두지 않고 `null` 로 비워 **누락을 숨기지 않는다**.
 *  - 앱 이름은 `locales/<appLocale>/android.json` 의 `android.appName` 을 재사용해
 *    런처 이름과 스토어 이름이 갈리지 않게 한다.
 *
 * 사용
 *   node scripts/store/build-global-listing.mjs            # 생성
 *   node scripts/store/build-global-listing.mjs --check     # 최신 여부·제한 검사
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const storeDir = join(rootDir, "store", "global");

/** Play listing locale ↔ 앱 locale. 계획(2026-08-15-global-content-store-release)이 정한 정확한 집합이다. */
export const LISTING_LOCALES = Object.freeze([
  { listing: "ko-KR", app: "ko" },
  { listing: "en-US", app: "en" },
  { listing: "ja-JP", app: "ja" },
  { listing: "zh-CN", app: "zh-CN" },
  { listing: "zh-TW", app: "zh-TW" },
  { listing: "vi", app: "vi" },
  { listing: "th", app: "th" },
  { listing: "id", app: "id" },
  { listing: "ms-MY", app: "ms" },
  { listing: "fil", app: "fil" },
]);

/** Play Console 필드 제한. */
export const LIMITS = Object.freeze({ appName: 30, shortDescription: 80, fullDescription: 4000 });

/**
 * Play 정책·계획이 금지한 표현. 가격·순위·설치 CTA·과장된 안전 보장은 listing 에 넣지 않는다.
 * 소문자로 비교한다.
 */
export const FORBIDDEN_PATTERNS = Object.freeze([
  { id: "price", pattern: /\d[\d,.]*\s*(?:원|won|usd|\$|฿|rp|rm|₫|円|元)/iu },
  { id: "discount", pattern: /(할인|무료 체험 \d|discount|sale|% off|정가)/i },
  { id: "ranking", pattern: /(1위|최고의|no\.?\s?1|best app|top app|award|수상)/i },
  { id: "install_cta", pattern: /(지금 설치|다운로드하세요|install now|download now)/i },
  { id: "absolute_safety", pattern: /(100% 안전|절대 안전|항상 보호|guaranteed safety|always protected)/i },
]);

/** 짧은 설명 — 10개 locale 완역(80자 제한 안). */
const SHORT_DESCRIPTION = {
  "ko-KR": "아빠가 아이를 위해 만든 가족 일정·안전 앱. 기본 기능은 무료로 이용하세요.",
  "en-US": "Family calendar and safety, built by a dad for his child. Core features free.",
  "ja-JP": "父親が自分の子どものために作った家族の予定・安全アプリ。基本機能は無料です。",
  "zh-CN": "一位父亲为自己孩子打造的家庭日程与安全应用。基本功能免费使用。",
  "zh-TW": "一位父親為自己孩子打造的家庭行程與安全應用程式。基本功能免費使用。",
  vi: "Lịch và an toàn gia đình, bố làm cho con. Tính năng cơ bản miễn phí.",
  th: "แอปตารางและความปลอดภัยของครอบครัวที่คุณพ่อทำให้ลูก ฟีเจอร์พื้นฐานใช้ฟรี",
  id: "Jadwal & keamanan keluarga, dibuat ayah untuk anaknya. Fitur dasar gratis.",
  "ms-MY": "Jadual & keselamatan keluarga, dibina bapa untuk anaknya. Ciri asas percuma.",
  fil: "Plano at kaligtasan ng pamilya, gawa ng isang ama. Libre ang pangunahing gamit.",
};

async function readSource() {
  return JSON.parse(await readFile(join(storeDir, "source", "ko-KR.json"), "utf8"));
}

async function readAppName(appLocale) {
  const catalog = JSON.parse(await readFile(join(rootDir, "locales", appLocale, "android.json"), "utf8"));
  const name = catalog["android.appName"];
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`android.appName 누락: ${appLocale}`);
  }
  return name;
}

/** 소스 섹션을 Play 전체 설명 텍스트로 조립한다. */
export function renderFullDescription({ intro, sections, disclosures, privacyPolicyUrl }) {
  const blocks = [intro];
  for (const section of sections) {
    blocks.push([section.heading, ...section.bullets.map((line) => `· ${line}`)].join("\n"));
  }
  for (const line of disclosures) blocks.push(line);
  blocks.push(`개인정보처리방침: ${privacyPolicyUrl}`);
  return blocks.join("\n\n");
}

export async function buildListingFiles() {
  const source = await readSource();
  const koFullDescription = renderFullDescription(source);
  const files = [];
  for (const { listing, app } of LISTING_LOCALES) {
    const isSource = listing === source.sourceLocale;
    const shortDescription = isSource ? source.shortDescription : SHORT_DESCRIPTION[listing];
    if (typeof shortDescription !== "string") throw new Error(`짧은 설명 누락: ${listing}`);
    files.push({
      listingLocale: listing,
      appLocale: app,
      content: {
        schemaVersion: 1,
        listingLocale: listing,
        appLocale: app,
        sourceLocale: source.sourceLocale,
        // 런처 이름과 스토어 이름을 하나로 유지한다.
        appName: await readAppName(app),
        shortDescription,
        // 전체 설명은 섹션 번역이 끝난 locale 만 값을 갖는다. 미번역을 한국어로 채우지 않는다.
        fullDescription: isSource ? koFullDescription : null,
        translationStatus: {
          appName: "translated",
          shortDescription: "translated",
          fullDescription: isSource ? "source" : "pending",
        },
        // Tier B 는 원어민 검수 evidence 가 있어야 승격한다. 생성기는 항상 draft 로 둔다.
        reviewStatus: "draft",
        reviewEvidence: null,
        claims: source.sections.flatMap(({ claims }) => claims),
      },
    });
  }
  return { source, files };
}

/** 길이·금지 표현·locale 집합을 검사한다. 번역 대기는 blocker 로 보고하되 오류로 만들지 않는다. */
export function validateListing(content) {
  const problems = [];
  const blockers = [];
  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = content[field];
    if (value == null) {
      if (content.translationStatus?.[field] === "pending") {
        blockers.push(`${content.listingLocale}:${field}:번역 대기`);
        continue;
      }
      problems.push(`${content.listingLocale}:${field}:값 없음`);
      continue;
    }
    if (typeof value !== "string") {
      problems.push(`${content.listingLocale}:${field}:문자열 아님`);
      continue;
    }
    if (value.length > limit) {
      problems.push(`${content.listingLocale}:${field}:${value.length}자 > ${limit}자`);
    }
  }
  for (const field of ["appName", "shortDescription", "fullDescription"]) {
    const value = content[field];
    if (typeof value !== "string") continue;
    for (const { id, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(value)) problems.push(`${content.listingLocale}:${field}:금지표현(${id})`);
    }
  }
  if (content.reviewStatus !== "draft" && !content.reviewEvidence) {
    problems.push(`${content.listingLocale}:reviewStatus:evidence 없이 승격됨`);
  }
  return { problems, blockers };
}

async function main() {
  const check = process.argv.includes("--check");
  const { files } = await buildListingFiles();
  const problems = [];
  const blockers = [];
  const stale = [];

  for (const { listingLocale, content } of files) {
    const result = validateListing(content);
    problems.push(...result.problems);
    blockers.push(...result.blockers);

    const path = join(storeDir, "locales", listingLocale, "listing.json");
    const next = `${JSON.stringify(content, null, 2)}\n`;
    const current = existsSync(path) ? await readFile(path, "utf8") : null;
    if (current === next) continue;
    stale.push(path);
    if (!check) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, next, "utf8");
    }
  }

  if (problems.length > 0) {
    console.error("listing 위반:");
    for (const line of problems) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  if (check && stale.length > 0) {
    console.error(`listing pack 이 최신이 아닙니다(${stale.length}개). node scripts/store/build-global-listing.mjs 를 실행하세요.`);
    process.exitCode = 1;
    return;
  }

  console.log(`${check ? "검사" : "생성"} 완료 — listing locale ${files.length}개, 위반 0건`);
  if (blockers.length > 0) {
    console.log(`\n출시 blocker ${blockers.length}건 (번역·검수 미완료 — 숨기지 않고 남긴다):`);
    for (const line of blockers) console.log(`  ${line}`);
    console.log("\n전체 설명은 store/global/source/ko-KR.json 의 섹션을 번역해 채운다.");
    console.log("Tier B 원어민 검수 evidence 가 있어야 reviewStatus 를 승격할 수 있다.");
  }
}

if (process.argv[1]?.endsWith("build-global-listing.mjs")) {
  await main();
}
