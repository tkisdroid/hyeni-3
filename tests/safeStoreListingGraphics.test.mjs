import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  generateSafeStoreListingGraphics,
  SAFE_STORE_LISTING_GRAPHICS,
  SAFE_STORE_LISTING_GRAPHICS_DIR,
} from "../scripts/create-safe-store-listing-graphics.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN_METADATA_CHUNKS = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);

function pngChunkTypes(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG 시그니처");
  const types = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    types.push(type);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  assert.equal(offset, buffer.length, "PNG chunk 경계");
  return types;
}

before(async () => {
  await generateSafeStoreListingGraphics();
});

test("스토어 대표 자산 생성기는 폐기 대상 실기기 캡처와 외부 데이터를 읽지 않는다", async () => {
  const source = await readFile(resolve(ROOT_DIR, "scripts/create-safe-store-listing-graphics.mjs"), "utf8");
  const sourceWithoutSvgNamespace = source.replaceAll("http://www.w3.org/2000/svg", "");
  assert.doesNotMatch(source, /output[\\/]store-screenshots|output[\\/]store-ui-candidates/);
  assert.doesNotMatch(sourceWithoutSvgNamespace, /\bfetch\s*\(|https?:\/\/|\badb\b|process\.env|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /(?:01[016789]|02|0[3-6][1-5])-?\d{3,4}-?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|KID-|QR|초대 코드/i);
});

test("Play 앱 아이콘은 512×512 32-bit PNG alpha와 1MiB 상한을 지킨다", async () => {
  const file = resolve(SAFE_STORE_LISTING_GRAPHICS_DIR, "play-icon-512.png");
  const [metadata, stats, fileStats] = await Promise.all([
    sharp(file).metadata(),
    sharp(file).stats(),
    stat(file),
  ]);
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.channels, 4);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.depth, "uchar");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.iptc, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.ok(fileStats.size <= 1024 * 1024, "Play 아이콘은 1MiB 이하여야 합니다");
  assert.ok(stats.channels.slice(0, 3).every((channel) => channel.stdev > 8), "아이콘이 비어 있음");
});

test("Play 피처 그래픽은 1024×500 24-bit PNG이며 alpha가 없다", async () => {
  const file = resolve(SAFE_STORE_LISTING_GRAPHICS_DIR, "play-feature-graphic-1024x500.png");
  const [metadata, stats] = await Promise.all([sharp(file).metadata(), sharp(file).stats()]);
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 500);
  assert.equal(metadata.channels, 3);
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.depth, "uchar");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.iptc, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.ok(stats.channels.every((channel) => channel.stdev > 8), "피처 그래픽이 비어 있음");
});

test("대표 자산 폴더는 승인 후보 2개만 포함하고 개인정보 메타데이터 chunk가 없다", async () => {
  const names = (await readdir(SAFE_STORE_LISTING_GRAPHICS_DIR)).sort();
  assert.deepEqual(names, SAFE_STORE_LISTING_GRAPHICS.map((asset) => asset.file).sort());
  for (const name of names) {
    const buffer = await readFile(resolve(SAFE_STORE_LISTING_GRAPHICS_DIR, name));
    for (const type of pngChunkTypes(buffer)) {
      assert.equal(FORBIDDEN_METADATA_CHUNKS.has(type), false, `${name} 금지 metadata chunk ${type}`);
    }
  }
});

test("스토어 등록정보 문서는 폐기 초안 대신 안전 대표 자산 경로와 검증 명령을 가리킨다", async () => {
  const listing = await readFile(resolve(ROOT_DIR, "docs/store/play-listing.md"), "utf8");
  assert.match(listing, /output\/store-listing-assets-v1\/play-icon-512\.png/);
  assert.match(listing, /output\/store-listing-assets-v1\/play-feature-graphic-1024x500\.png/);
  assert.match(listing, /node scripts\/create-safe-store-listing-graphics\.mjs/);
  assert.match(listing, /node --test tests\/safeStoreListingGraphics\.test\.mjs/);
  assert.match(listing, /기존 `output\/store-screenshots\/`[^\n]+재사용·업로드하지 않는다/);
});
