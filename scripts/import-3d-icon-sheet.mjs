/**
 * 한 장에 여러 개가 그려진 소프트 3D 아이콘 시트를 앱 자산으로 나눠 들여온다.
 *
 * 생성 이미지는 알파가 없고 흰 배경이라, 테두리에서 시작하는 flood fill 로 **배경만** 지운다.
 * (전체 밝기 임계값으로 지우면 아이콘 안쪽 흰 하이라이트까지 뚫린다 — 실제로 그렇게 깨진다.)
 *
 * 사용: node scripts/import-3d-icon-sheet.mjs <시트 이미지> <slug1,slug2,...>
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ui");
const OUTPUT_SIZE = 256;
const WEBP_QUALITY = 88;
/** 배경으로 볼 밝기(0~255)와 채도 상한 — 흰 배경만 잡고 노란 하이라이트는 남긴다. */
const BACKGROUND_MIN_LUMA = 236;
const BACKGROUND_MAX_CHROMA = 14;

/** 테두리에서 이어진 배경 픽셀만 투명으로 만든다. */
export function keyOutBorderBackground(data, width, height, channels) {
  const isBackground = (index) => {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return Math.min(r, g, b) >= BACKGROUND_MIN_LUMA && chroma <= BACKGROUND_MAX_CHROMA;
  };
  const transparent = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (transparent[pixel]) return;
    if (!isBackground(pixel * channels)) return;
    transparent[pixel] = 1;
    queue.push(pixel);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (queue.length > 0) {
    const pixel = queue.pop();
    const x = pixel % width;
    const y = (pixel - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return transparent;
}

async function main() {
  const [sheetPath, slugList] = process.argv.slice(2);
  if (!sheetPath || !slugList) throw new Error("시트 경로와 slug 목록이 필요합니다");
  const slugs = slugList.split(",").map((slug) => slug.trim()).filter(Boolean);
  await mkdir(OUTPUT_DIR, { recursive: true });

  const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const transparent = keyOutBorderBackground(data, width, height, channels);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (transparent[pixel]) data[pixel * channels + 3] = 0;
  }

  const tileWidth = Math.floor(width / slugs.length);
  const report = [];
  for (const [index, slug] of slugs.entries()) {
    const output = join(OUTPUT_DIR, `${slug}.webp`);
    // 자르기와 여백 정리는 파이프라인을 나눠 실행한다(한 번에 하면 extract 영역 계산이 어긋난다).
    const tile = await sharp(data, { raw: { width, height, channels } })
      .extract({ left: index * tileWidth, top: 0, width: tileWidth, height })
      .png()
      .toBuffer();
    const written = await sharp(tile)
      .trim({ threshold: 1 })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100 })
      .toFile(output);
    report.push(`${slug}.webp\t${written.size}B`);
  }
  console.log(report.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
