/**
 * 아이 AI 친구 감정 채팅 버튼 20종을 앱 자산으로 들여온다.
 *
 * 원본은 512×512 PNG이고 **알파가 없다**(무지개 그라디언트 배경이 그림에 포함되어 있다).
 * 그래서 화면에서는 배경을 지우지 않고 둥근 버튼 면으로 쓰고, 파일은 표시 크기의 3배까지
 * 감당할 256px webp로 줄인다.
 *
 * 사용: node scripts/import-ai-buddy-chat-emotions.mjs "<원본 폴더>"
 *   원본 폴더에는 한글 이름 PNG 20개가 있어야 한다(미리보기 시트는 무시한다).
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ai-buddy", "chat");
const OUTPUT_SIZE = 256;
const WEBP_QUALITY = 86;

/** 한글 파일 이름 → 앱에서 쓰는 감정 slug. 표는 코드가 참조하는 정본이다. */
export const EMOTION_FILE_SLUGS = Object.freeze({
  "행복": "happy",
  "윙크": "wink",
  "즐거움": "joy",
  "기대": "excited",
  "사랑": "love",
  "궁금함": "curious",
  "고민": "thinking",
  "아이디어": "idea",
  "대화중": "talking",
  "졸림": "sleepy",
  "슬픔": "sad",
  "걱정": "worried",
  "수줍음": "shy",
  "축하": "celebrate",
  "인사": "greeting",
  "음악듣기": "music",
  "탐색": "explore",
  "입력중": "typing",
  "기다림": "waiting",
  "빠른응답": "quick",
});

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("원본 폴더 경로가 필요합니다");

  const entries = (await readdir(sourceDir)).filter((name) => name.toLowerCase().endsWith(".png"));
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  for (const [korean, slug] of Object.entries(EMOTION_FILE_SLUGS)) {
    const file = entries.find((name) => name === `${korean}.png`);
    if (!file) throw new Error(`${korean}.png 를 찾지 못했습니다`);
    const input = join(sourceDir, file);
    const metadata = await sharp(input).metadata();
    if (metadata.width !== metadata.height) {
      throw new Error(`${file}: 정사각형이 아닙니다(${metadata.width}x${metadata.height})`);
    }
    const output = join(OUTPUT_DIR, `${slug}.webp`);
    const info = await sharp(input)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
      .webp({ quality: WEBP_QUALITY })
      .toFile(output);
    report.push({ slug, korean, bytes: info.size, source: `${metadata.width}x${metadata.height}` });
  }

  const manifest = report
    .map(({ slug, korean, bytes }) => `${slug}\t${korean}\t${bytes}B`)
    .join("\n");
  await writeFile(join(OUTPUT_DIR, "manifest.txt"), `${manifest}\n`, "utf8");
  const total = report.reduce((sum, row) => sum + row.bytes, 0);
  console.log(`${report.length}종 변환 완료 · 합계 ${(total / 1024).toFixed(1)}KB`);
  console.log(manifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
