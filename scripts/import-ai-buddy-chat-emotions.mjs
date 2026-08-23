/**
 * 아이 모드 AI 친구의 3D 캐릭터 포즈 18종을 앱 자산으로 들여온다.
 *
 * 원본은 1024×1024 투명 PNG다. 바닥 그림자와 손·발·소품을 자르지 않도록 여백만 trim한 뒤
 * 90% 안전영역 안에 contain하고, 320px 투명 WebP로 줄인다. 홈 FAB(88px)와 대화 전환
 * 얼굴(168px)에서 한 자산을 함께 써도 선명하면서 PWA 용량은 과도하게 커지지 않는 크기다.
 *
 * 사용: node scripts/import-ai-buddy-chat-emotions.mjs "<원본 폴더>"
 *   원본 폴더에는 아래 이름의 PNG 18개가 모두 있어야 한다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ai-buddy", "poses");
const OUTPUT_SIZE = 320;
const CONTENT_SIZE = 288;
const PADDING = (OUTPUT_SIZE - CONTENT_SIZE) / 2;
const WEBP_QUALITY = 88;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** 원본 파일 이름 → 앱 포즈 slug. 파일 순서는 캐릭터 원본의 01~18 순서다. */
export const AI_BUDDY_POSE_FILES = Object.freeze({
  "01_환영_손흔들기.png": "welcome",
  "02_대기_공손한인사.png": "polite",
  "03_사랑_하트안기.png": "heart-hug",
  "04_신남_점프.png": "jump",
  "05_칭찬_왕관엄지척.png": "crown",
  "06_궁금_생각하기.png": "thinking",
  "07_응답중_태블릿.png": "tablet",
  "08_아이디어_전달.png": "idea",
  "09_즐거움_헤드폰.png": "headphones",
  "10_탐색_돋보기.png": "explore",
  "11_긴급_달려가기.png": "rush",
  "12_대기_빼꼼.png": "peek",
  "13_휴식_잠자기.png": "sleep",
  "14_애정_하트보내기.png": "heart-send",
  "15_기대_대기.png": "expecting",
  "16_걱정_울음.png": "worried",
  "17_칭찬_엄지척.png": "thumbs-up",
  "18_출발_로켓.png": "rocket",
});

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("원본 폴더 경로가 필요합니다");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  for (const [file, slug] of Object.entries(AI_BUDDY_POSE_FILES)) {
    const input = join(sourceDir, file);
    const metadata = await sharp(input).metadata();
    if (metadata.width !== 1024 || metadata.height !== 1024) {
      throw new Error(`${file}: 1024x1024 원본이 아닙니다(${metadata.width}x${metadata.height})`);
    }
    if (!metadata.hasAlpha) throw new Error(`${file}: 투명 배경이 아닙니다`);

    const trimmed = await sharp(input).trim({ threshold: 1 }).toBuffer();
    const info = await sharp(trimmed)
      .resize(CONTENT_SIZE, CONTENT_SIZE, { fit: "contain", background: TRANSPARENT })
      .extend({ top: PADDING, right: PADDING, bottom: PADDING, left: PADDING, background: TRANSPARENT })
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100, smartSubsample: true })
      .toFile(join(OUTPUT_DIR, `${slug}.webp`));
    report.push({ slug, file, bytes: info.size });
  }

  const manifest = report
    .map(({ slug, file, bytes }) => `${slug}\t${file}\t${bytes}B`)
    .join("\n");
  await writeFile(join(OUTPUT_DIR, "manifest.txt"), `${manifest}\n`, "utf8");
  const total = report.reduce((sum, row) => sum + row.bytes, 0);
  console.log(`${report.length}종 변환 완료 · 합계 ${(total / 1024).toFixed(1)}KB`);
  console.log(manifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
