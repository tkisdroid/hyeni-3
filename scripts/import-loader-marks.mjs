/**
 * TK 가 준 로딩 마크(애니메이션 webp 2종)를 앱 자산으로 들여온다.
 *
 * 원본은 이미 256px·투명·36프레임(70ms 루프)이라 크기·프레임은 그대로 두고
 * 재인코딩(q88)만 한다 — 눈으로 같은 그림인데 파일이 1/3 로 줄어 설치 precache 가 가벼워진다.
 *
 * 애니메이션 webp 는 CSS 로 멈출 수 없으므로 **정지 프레임을 함께 만든다**.
 * 화면은 <picture media="(prefers-reduced-motion: reduce)"> 로 이 정지본을 쓰고,
 * 그래서 움직임 줄이기에서도 점 3개 로더와 같은 방식으로 조용해진다.
 *
 * 파일 이름 → 앱 slug 표가 이 스크립트의 정본이고, 화면은 slug 로만 참조한다.
 *
 * 사용: node scripts/import-loader-marks.mjs "<원본 폴더>"
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ui");
const WEBP_QUALITY = 88;

/**
 * 정지 프레임은 루프 중간을 쓴다.
 * 마지막 프레임(체크 완료·하트)은 "끝났다"로 읽혀 로딩 중 표시로는 거짓말이 된다.
 */
const STILL_FRAME_RATIO = 0.5;

/** 원본 파일 → 앱 자산 slug. */
export const LOADER_MARK_FILES = Object.freeze({
  "01_calendar_check_loader_256.webp": "calendar",
  "03_location_route_loader_256.webp": "location",
});

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("원본 폴더 경로가 필요합니다");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  for (const [file, slug] of Object.entries(LOADER_MARK_FILES)) {
    const input = join(sourceDir, file);
    const metadata = await sharp(input, { animated: true }).metadata();
    if (!metadata.hasAlpha) throw new Error(`${file}: 투명 배경이 아닙니다`);
    if (!metadata.pages || metadata.pages < 2) throw new Error(`${file}: 애니메이션이 아닙니다`);

    const animated = await sharp(input, { animated: true })
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();
    const animatedMeta = await sharp(animated, { animated: true }).metadata();
    if (animatedMeta.pages !== metadata.pages) throw new Error(`${file}: 프레임이 유실됐습니다`);

    // 정지본은 프레임을 세로로 이어 붙인 스트립(PNG)에서 한 장만 잘라 만든다.
    // animated 로 읽은 파이프라인에 바로 extract 를 걸면 페이지 경계와 어긋난다.
    const frameHeight = metadata.pageHeight ?? metadata.width;
    const stillIndex = Math.floor(metadata.pages * STILL_FRAME_RATIO);
    const strip = await sharp(input, { animated: true }).png().toBuffer();
    const still = await sharp(strip)
      .extract({ left: 0, top: stillIndex * frameHeight, width: metadata.width, height: frameHeight })
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();

    await writeFile(join(OUTPUT_DIR, `loader-${slug}.webp`), animated);
    await writeFile(join(OUTPUT_DIR, `loader-${slug}-still.webp`), still);
    report.push({
      slug,
      frames: animatedMeta.pages,
      delayMs: metadata.delay?.[0] ?? null,
      stillFrame: stillIndex,
      animatedKb: Number((animated.length / 1024).toFixed(1)),
      stillKb: Number((still.length / 1024).toFixed(1)),
    });
  }

  console.table(report);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
