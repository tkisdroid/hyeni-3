/**
 * Play 10-locale listing pack 회귀.
 *
 * 스토어 문구는 앱 카탈로그와 다른 파이프라인이라 조용히 어긋나기 쉽다. 특히
 *  · 앱 이름이 런처(`android.appName`)와 스토어에서 갈리면 사용자가 다른 앱으로 인식한다.
 *  · Play 필드 제한(앱 이름 30 · 짧은 설명 80 · 전체 설명 4000)을 넘으면 등록 자체가 막힌다.
 *  · 미번역을 한국어로 채워 두면 "번역됨"으로 보여 검수 없이 공개될 수 있다.
 * 이 세 가지를 고정한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LIMITS,
  LISTING_LOCALES,
  buildListingFiles,
  renderFullDescription,
  validateListing,
} from "../scripts/store/build-global-listing.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = join(rootDir, "store", "global");

test("listing locale 집합은 계획이 정한 10개와 정확히 같다", () => {
  assert.deepEqual(
    LISTING_LOCALES.map(({ listing }) => listing),
    ["ko-KR", "en-US", "ja-JP", "zh-CN", "zh-TW", "vi", "th", "id", "ms-MY", "fil"],
  );
  // 앱 locale 과 1:1 로 대응해야 브랜드·앱 이름을 재사용할 수 있다.
  assert.deepEqual(
    LISTING_LOCALES.map(({ app }) => app),
    ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"],
  );
});

test("생성된 listing 파일이 10개 모두 있고 Play 제한을 지킨다", async () => {
  const { files } = await buildListingFiles();
  assert.equal(files.length, 10);
  for (const { listingLocale, content } of files) {
    const path = join(storeDir, "locales", listingLocale, "listing.json");
    assert.ok(existsSync(path), `${path} 없음 — npm run store:listing 을 실행하세요`);
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(onDisk, content, `${listingLocale}: 파일이 정본과 다릅니다`);

    assert.ok(content.appName.length <= LIMITS.appName, `${listingLocale}: 앱 이름 ${content.appName.length}자`);
    assert.ok(
      content.shortDescription.length <= LIMITS.shortDescription,
      `${listingLocale}: 짧은 설명 ${content.shortDescription.length}자 > ${LIMITS.shortDescription}`,
    );
    if (typeof content.fullDescription === "string") {
      assert.ok(
        content.fullDescription.length <= LIMITS.fullDescription,
        `${listingLocale}: 전체 설명 ${content.fullDescription.length}자`,
      );
    }
  }
});

test("앱 이름은 런처 리소스(android.appName)와 정확히 같다", async () => {
  const { files } = await buildListingFiles();
  for (const { listingLocale, appLocale, content } of files) {
    const catalog = JSON.parse(await readFile(join(rootDir, "locales", appLocale, "android.json"), "utf8"));
    assert.equal(content.appName, catalog["android.appName"], `${listingLocale}: 런처 이름과 불일치`);
  }
});

test("미번역 전체 설명은 한국어로 채우지 않고 pending 으로 남긴다", async () => {
  const { files } = await buildListingFiles();
  const korean = files.find(({ listingLocale }) => listingLocale === "ko-KR");
  assert.equal(korean.content.translationStatus.fullDescription, "source");
  assert.equal(typeof korean.content.fullDescription, "string");

  for (const { listingLocale, content } of files) {
    if (listingLocale === "ko-KR") continue;
    if (content.translationStatus.fullDescription === "pending") {
      assert.equal(content.fullDescription, null, `${listingLocale}: pending 인데 값이 채워져 있습니다`);
      continue;
    }
    // 번역됐다고 표시했으면 한국어 원문을 그대로 복사한 것이 아니어야 한다.
    assert.notEqual(content.fullDescription, korean.content.fullDescription, `${listingLocale}: 한국어 복사본`);
  }
});

test("검수 evidence 없이 reviewStatus 를 승격하지 못한다", () => {
  const base = {
    listingLocale: "en-US",
    appName: "Hyeni Calendar: Family Safety",
    shortDescription: "Family calendar and safety.",
    fullDescription: "Family calendar and safety details.",
    translationStatus: { appName: "translated", shortDescription: "translated", fullDescription: "translated" },
    reviewStatus: "approved",
    reviewEvidence: null,
  };
  assert.ok(validateListing(base).problems.some((line) => line.includes("evidence 없이 승격")));
  assert.deepEqual(validateListing({ ...base, reviewStatus: "draft" }).problems, []);
});

test("가격·순위·설치 CTA·절대 안전 표현을 거부한다", () => {
  const make = (fullDescription) => ({
    listingLocale: "en-US",
    appName: "Hyeni Calendar",
    shortDescription: "Family calendar.",
    fullDescription,
    translationStatus: { appName: "translated", shortDescription: "translated", fullDescription: "translated" },
    reviewStatus: "draft",
    reviewEvidence: null,
  });
  for (const bad of [
    "Only 4900원 per month",
    "The best app for families",
    "Download now to protect your child",
    "Your child is 100% 안전",
  ]) {
    const { problems } = validateListing(make(bad));
    assert.ok(problems.some((line) => line.includes("금지표현")), `허용돼서는 안 되는 문구: ${bad}`);
  }
});

test("전체 설명은 소스 섹션에서 조립되고 정직 고지를 포함한다", async () => {
  const source = JSON.parse(await readFile(join(storeDir, "source", "ko-KR.json"), "utf8"));
  const rendered = renderFullDescription(source);
  for (const section of source.sections) {
    assert.ok(rendered.includes(section.heading), `섹션 누락: ${section.id}`);
  }
  // 지연 가능성과 공공 긴급 서비스 안내는 빼면 안 된다(과장 금지).
  assert.match(rendered, /늦거나 제공되지 않을 수 있습니다/);
  assert.match(rendered, /112·119/);
  assert.match(rendered, /광고를 표시하지 않으며/);
  assert.ok(rendered.length <= LIMITS.fullDescription, `전체 설명 ${rendered.length}자`);
});
