import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after, before } from "node:test";
import sharp from "sharp";
import {
  generatePlayStoreFinalAssets,
  PLAY_STORE_FINAL_IMAGES,
  PLAY_STORE_SCREENSHOTS,
  PLAY_STORE_SOURCE_ICON,
} from "../scripts/create-play-store-final-assets.mjs";

const FORBIDDEN_METADATA_CHUNKS = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);
let outputDir;

function pngChunkTypes(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const types = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    types.push(type);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  assert.equal(offset, buffer.length);
  return types;
}

before(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "hyeni-play-store-final-"));
  await generatePlayStoreFinalAssets({ outputDir });
});

after(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

test("최종 스토어 생성기는 실제 production UI 후보와 브랜드 아이콘만 사용한다", async () => {
  const source = await readFile(new URL("../scripts/create-play-store-final-assets.mjs", import.meta.url), "utf8");
  const sourceWithoutSvgNamespace = source.replaceAll("http://www.w3.org/2000/svg", "");
  assert.match(source, /output\/store-ui-candidates-v1/);
  assert.match(source, /assets\/11-store-listing\/store-icon-512\.png/);
  assert.doesNotMatch(
    sourceWithoutSvgNamespace,
    /output[\\/]store-screenshots|\badb\b|\bfetch\s*\(|https?:\/\/|process\.env/,
  );
  assert.doesNotMatch(source, /01\/07|02\/07|무료로 시작|4,900|39,000|₩/);
  assert.equal(PLAY_STORE_SCREENSHOTS.length, 6);
});

test("최종 앱 아이콘은 Android 설치 아이콘과 같은 픽셀을 사용한다", async () => {
  const [source, generated] = await Promise.all([
    sharp(PLAY_STORE_SOURCE_ICON).ensureAlpha().raw().toBuffer(),
    sharp(resolve(outputDir, "play-icon-512.png")).ensureAlpha().raw().toBuffer(),
  ]);
  assert.deepEqual(generated, source);
  assert.ok((await stat(resolve(outputDir, "play-icon-512.png"))).size <= 1024 * 1024);
});

test("최종 Play 이미지 8개는 정확한 크기·색상·메타데이터 계약을 지킨다", async () => {
  for (const spec of PLAY_STORE_FINAL_IMAGES) {
    const file = resolve(outputDir, spec.file);
    const [metadata, stats, buffer] = await Promise.all([sharp(file).metadata(), sharp(file).stats(), readFile(file)]);
    assert.equal(metadata.format, "png", spec.file);
    assert.equal(metadata.width, spec.width, spec.file);
    assert.equal(metadata.height, spec.height, spec.file);
    assert.equal(metadata.hasAlpha, spec.alpha, spec.file);
    assert.equal(metadata.exif, undefined, spec.file);
    assert.equal(metadata.iptc, undefined, spec.file);
    assert.equal(metadata.xmp, undefined, spec.file);
    assert.ok(stats.channels.slice(0, 3).every((channel) => channel.stdev > 7), `${spec.file}가 비어 있음`);
    for (const type of pngChunkTypes(buffer)) {
      assert.equal(FORBIDDEN_METADATA_CHUNKS.has(type), false, `${spec.file} 금지 chunk ${type}`);
    }
  }
});

test("기본 생성 결과는 육안 승인 전이며 검증 manifest와 정확한 파일 집합을 남긴다", async () => {
  const names = (await readdir(outputDir)).sort();
  assert.deepEqual(
    names,
    [...PLAY_STORE_FINAL_IMAGES.map((asset) => asset.file), "manifest.json", "technical-review.json"].sort(),
  );
  const review = JSON.parse(await readFile(resolve(outputDir, "technical-review.json"), "utf8"));
  assert.equal(review.verdict, "TECHNICAL_REVIEW_PASSED");
  assert.equal(review.playUploadApproved, false);
  assert.equal(review.checks.pricingOrPromotionOverlayAbsent, true);
  assert.equal(review.checks.decorativeBadgesAndOrdinalMarkersAbsent, true);
});

test("스토어 문서와 제출 정본은 최종 자산 폴더와 비프로모션 문구를 가리킨다", async () => {
  const [listing, submission] = await Promise.all([
    readFile(new URL("../docs/store/play-listing.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/store/play-console-submission-v1.3.0.md", import.meta.url), "utf8"),
  ]);
  for (const source of [listing, submission]) assert.match(source, /output\/play-store-final-v1/);
  assert.match(listing, /가족 캘린더와 아이 위치를 한눈에/);
  assert.doesNotMatch(listing, /📅|📍|🆘|💬|🤖|🎧|👑|🔐/);
  assert.match(submission, /가격·할인·무료 프로모션을 넣지 않고/);
});
