/**
 * 클레이 스타일 SVG 아이콘(`assets/01-runtime-3d/ui/*.svg`)을 앱 자산 webp 로 굽는다.
 *
 * 왜 필요한가: 이 세트는 평면 라인 SVG 가 아니라 그라디언트·그림자를 가진 클레이 스타일이라
 * 3D webp 와 같은 슬롯에 놓아도 톤이 맞는다. 다만 SVG 를 `public/` 에 그대로 넣으면
 * ①빌드 산출물에 `.svg` 가 섞이고 ②색 칩 위에서 테두리가 그대로 보인다. 그래서 알파 투명
 * 256px webp 로 굽는다(디자인 규칙: 새 3D 아이콘은 3D 원본 팩 우선, 없으면 클레이 SVG→sharp 렌더).
 *
 * ⚠️ 2026-09-22 이전에는 이 변환이 없어서 `ui/settings-faq.svg` 를 참조하는 피드백 화면의
 *    '사용 방법 질문' 타일만 깨진 이미지 상자로 보였다(실기기 E2E 에서 404 3회 재현).
 *    파일 이름 → 앱 slug 표가 이 스크립트의 정본이고, 화면은 slug 로만 참조한다.
 *
 * 사용: node scripts/import-clay-svg-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT_DIR, "assets", "01-runtime-3d", "ui");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ui");
const OUTPUT_SIZE = 256;
const WEBP_QUALITY = 88;
/** 원본 96px viewBox 를 256px 로 굽기 위해 3배 밀도로 렌더한다(확대 시 계단 없게). */
const RENDER_DENSITY = 288;

/** 원본 파일 → 앱 자산 이름. */
export const CLAY_SVG_ICON_FILES = Object.freeze({
  "settings-faq.svg": "settings-faq.webp",
});

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  for (const [file, output] of Object.entries(CLAY_SVG_ICON_FILES)) {
    const input = join(SOURCE_DIR, file);
    const rendered = await sharp(input, { density: RENDER_DENSITY })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const metadata = await sharp(rendered).metadata();
    if (!metadata.hasAlpha) throw new Error(`${file}: 알파 채널이 없습니다`);
    const info = await sharp(rendered)
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100 })
      .toFile(join(OUTPUT_DIR, output));
    report.push(`${output}\t${info.size}B\t원본 ${file}`);
  }
  await writeFile(join(OUTPUT_DIR, "clay-svg-icons.txt"), `${report.join("\n")}\n`, "utf8");
  console.log(report.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
