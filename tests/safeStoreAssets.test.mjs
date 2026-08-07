import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  generateSafeStoreAssets,
  SAFE_DEMO_FOOTER,
  SAFE_STORE_ASSETS,
  SAFE_STORE_CREATIVE_DRAFT_DIR,
  STORE_ASSET_HEIGHT,
  STORE_ASSET_WIDTH,
  verifyStoreAssetSourceContracts,
} from "../scripts/create-safe-store-assets.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN_METADATA_CHUNKS = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function pngChunkTypes(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "PNG 시그니처가 아님");
  const types = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    types.push(type);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  assert.equal(offset, buffer.length, "PNG chunk 경계가 올바르지 않음");
  return types;
}

before(async () => {
  await generateSafeStoreAssets();
});

test("스토어 자산 생성은 현재 가격·티어 코드 정본과 연결된다", async () => {
  await verifyStoreAssetSourceContracts();
  const copy = collectStrings(SAFE_STORE_ASSETS).join("\n");
  assert.match(copy, /월 4,900원/);
  assert.match(copy, /연 39,000원/);
  assert.match(copy, /Free도 위치 확인/);
  assert.match(copy, /Premium은 실시간/);
  assert.match(copy, /SOS와 긴급 알림은\n항상 무료/);
  assert.doesNotMatch(copy, /2,900원|27,840원/);
});

test("생성 스크립트는 사용자 데이터·API·기기·기존 민감 초안을 입력으로 읽지 않는다", async () => {
  const source = await readFile(resolve(ROOT_DIR, "scripts/create-safe-store-assets.mjs"), "utf8");
  const sourceWithoutSvgNamespace = source.replaceAll("http://www.w3.org/2000/svg", "");
  assert.doesNotMatch(source, /output[\\/]store-screenshots/);
  assert.doesNotMatch(sourceWithoutSvgNamespace, /\bfetch\s*\(|https?:\/\/|\badb\b|child_process|exec(?:File|Sync)?\s*\(/);
  assert.doesNotMatch(source, /process\.env|localStorage|sessionStorage/);
  assert.match(source, /src\/transform\/webBilling\.ts/);
  assert.match(source, /src\/transform\/tierPolicy\.ts/);
});

test("합성 문구에는 개인정보·연락처·좌표·초대 정보가 없다", () => {
  const copy = [...collectStrings(SAFE_STORE_ASSETS), SAFE_DEMO_FOOTER].join("\n");
  assert.match(copy, /합성 데모/);
  assert.match(copy, /모든 인물·일정·위치 정보는 합성 데모 데이터/);
  assert.doesNotMatch(copy, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(copy, /(?:01[016789]|02|0[3-6][1-5])-?\d{3,4}-?\d{4}/);
  assert.doesNotMatch(copy, /(?:위도|경도|latitude|longitude|초대\s*코드|페어링\s*코드|QR|KID-)/i);
  assert.doesNotMatch(copy, /https?:\/\//i);
  assert.doesNotMatch(copy, /\d{2,3}\.\d{3,},\s*\d{2,3}\.\d{3,}/);
});

test("내부 creative draft 폴더에는 1080×1920 불투명 24-bit PNG 6장만 있다", async () => {
  const names = (await readdir(SAFE_STORE_CREATIVE_DRAFT_DIR)).sort();
  const expected = SAFE_STORE_ASSETS.map((asset) => asset.file).sort();
  assert.deepEqual(names, expected);
  assert.ok(names.length >= 4 && names.length <= 8);

  for (const name of names) {
    assert.equal(extname(name), ".png");
    const file = resolve(SAFE_STORE_CREATIVE_DRAFT_DIR, name);
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, "png", `${name} format`);
    assert.equal(metadata.width, STORE_ASSET_WIDTH, `${name} width`);
    assert.equal(metadata.height, STORE_ASSET_HEIGHT, `${name} height`);
    assert.equal(metadata.channels, 3, `${name} 24-bit RGB channels`);
    assert.equal(metadata.hasAlpha, false, `${name} alpha`);
    assert.equal(metadata.depth, "uchar", `${name} 8-bit depth`);
    assert.equal(metadata.pages, undefined, `${name} 단일 이미지`);
  }
});

test("생성 PNG는 개인정보를 담을 수 있는 텍스트·EXIF 메타데이터가 없고 시각 내용이 비어 있지 않다", async () => {
  for (const asset of SAFE_STORE_ASSETS) {
    const file = resolve(SAFE_STORE_CREATIVE_DRAFT_DIR, asset.file);
    const [buffer, metadata, stats] = await Promise.all([
      readFile(file),
      sharp(file).metadata(),
      sharp(file).stats(),
    ]);
    assert.equal(metadata.exif, undefined, `${asset.file} EXIF`);
    assert.equal(metadata.iptc, undefined, `${asset.file} IPTC`);
    assert.equal(metadata.xmp, undefined, `${asset.file} XMP`);
    for (const type of pngChunkTypes(buffer)) {
      assert.equal(FORBIDDEN_METADATA_CHUNKS.has(type), false, `${asset.file} 금지 metadata chunk ${type}`);
    }
    assert.ok(buffer.length > 80_000, `${asset.file}가 비정상적으로 작음`);
    assert.ok(stats.channels.every((channel) => channel.stdev > 12), `${asset.file} 시각 정보가 충분하지 않음`);
  }
});
