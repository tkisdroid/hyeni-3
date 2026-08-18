/**
 * TK 가 준 소프트 3D 아이콘(카메라·마이크·연필)을 앱 자산으로 들여온다.
 *
 * 부모 설정의 사진·수정·주변 소리 자리에 쓰는 아이콘이라 **투명 배경**이어야 한다
 * (색 칩 위에 얹기 때문에 흰 배경이면 네모가 그대로 보인다).
 * 원본은 큰 정사각 PNG이고 표시 크기의 3배까지 감당할 256px webp 로 줄인다.
 *
 * 사용: node scripts/import-simple-3d-icons.mjs "<원본 폴더>"
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ui");
const OUTPUT_SIZE = 256;
const WEBP_QUALITY = 88;

/** 원본 파일 이름 → 앱에서 쓰는 자산 이름. */
export const SIMPLE_3D_ICON_FILES = Object.freeze({
  "camera_icon_3d_transparent.png": "camera-3d.webp",
  "microphone_icon_3d_transparent.png": "mic-3d.webp",
  "pencil_icon_3d_transparent.png": "pencil-3d.webp",
});

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("원본 폴더 경로가 필요합니다");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  for (const [file, output] of Object.entries(SIMPLE_3D_ICON_FILES)) {
    const input = join(sourceDir, file);
    const metadata = await sharp(input).metadata();
    if (!metadata.hasAlpha) throw new Error(`${file}: 투명 배경이 아닙니다`);
    // 여백을 잘라 아이콘이 슬롯을 꽉 채우게 한 뒤 정사각으로 맞춘다.
    const trimmed = await sharp(input).trim({ threshold: 1 }).toBuffer();
    const info = await sharp(trimmed)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100 })
      .toFile(join(OUTPUT_DIR, output));
    report.push(`${output}\t${info.size}B\t원본 ${metadata.width}x${metadata.height}`);
  }
  await writeFile(join(OUTPUT_DIR, "simple-3d-icons.txt"), `${report.join("\n")}\n`, "utf8");
  console.log(report.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
