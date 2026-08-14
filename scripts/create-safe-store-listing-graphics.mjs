import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SAFE_STORE_LISTING_GRAPHICS_DIR = resolve(ROOT_DIR, "output/store-listing-assets-v1");

export const SAFE_STORE_LISTING_GRAPHICS = Object.freeze([
  Object.freeze({ file: "play-icon-512.png", kind: "icon" }),
  Object.freeze({ file: "play-feature-graphic-1024x500.png", kind: "feature" }),
]);

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="background" x1="32" y1="16" x2="480" y2="496" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFD9E8"/>
      <stop offset="1" stop-color="#F7B8D2"/>
    </linearGradient>
    <filter id="shadow" x="72" y="82" width="368" height="372" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#7A3151" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#background)"/>
  <circle cx="82" cy="80" r="76" fill="#FFFFFF" opacity="0.28"/>
  <circle cx="450" cy="430" r="112" fill="#FFFFFF" opacity="0.2"/>
  <g filter="url(#shadow)">
    <rect x="112" y="112" width="288" height="288" rx="72" fill="#FFF9FB"/>
    <path d="M112 184c0-39.765 32.235-72 72-72h144c39.765 0 72 32.235 72 72v34H112v-34Z" fill="#D93072"/>
    <rect x="174" y="82" width="30" height="84" rx="15" fill="#7A3151"/>
    <rect x="308" y="82" width="30" height="84" rx="15" fill="#7A3151"/>
    <path d="M256 352c-8-8-66-48-66-91 0-27 20-47 47-47 16 0 30 8 39 21 9-13 23-21 39-21 27 0 47 20 47 47 0 43-58 83-66 91l-20 17-20-17Z" fill="#D93072"/>
    <path d="m227 282 22 22 43-51" fill="none" stroke="#FFFFFF" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const FEATURE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1024" y2="500" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFF1F6"/>
      <stop offset="0.55" stop-color="#FDE7F1"/>
      <stop offset="1" stop-color="#EEE7FF"/>
    </linearGradient>
    <filter id="shadow" x="500" y="54" width="450" height="400" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#6D4154" flood-opacity="0.18"/>
    </filter>
    <style>
      text { font-family: "Pretendard", "Malgun Gothic", "Noto Sans KR", Arial, sans-serif; }
    </style>
  </defs>
  <rect width="1024" height="500" fill="url(#background)"/>
  <circle cx="980" cy="34" r="154" fill="#FFFFFF" opacity="0.34"/>
  <circle cx="72" cy="470" r="152" fill="#FFFFFF" opacity="0.28"/>
  <text x="72" y="192" font-size="62" font-weight="850" letter-spacing="-2" fill="#2D2430">혜니캘린더</text>
  <text x="72" y="264" font-size="32" font-weight="700" letter-spacing="-1" fill="#6C5873">함께 보는 가족 일정</text>
  <text x="72" y="316" font-size="32" font-weight="700" letter-spacing="-1" fill="#6C5873">아이 위치와 안전 확인까지</text>
  <rect x="72" y="362" width="246" height="58" rx="29" fill="#D93072"/>
  <text x="195" y="401" text-anchor="middle" font-size="24" font-weight="800" fill="#FFFFFF">일정 · 위치 · 가족 안전</text>
  <g filter="url(#shadow)">
    <rect x="548" y="86" width="336" height="328" rx="64" fill="#FFFFFF"/>
    <path d="M548 150c0-35.346 28.654-64 64-64h208c35.346 0 64 28.654 64 64v34H548v-34Z" fill="#D93072"/>
    <rect x="614" y="62" width="28" height="82" rx="14" fill="#7A3151"/>
    <rect x="790" y="62" width="28" height="82" rx="14" fill="#7A3151"/>
    <circle cx="636" cy="246" r="24" fill="#FDE7F1"/>
    <circle cx="716" cy="246" r="24" fill="#FDE7F1"/>
    <circle cx="796" cy="246" r="24" fill="#FDE7F1"/>
    <circle cx="636" cy="326" r="24" fill="#FDE7F1"/>
    <path d="M790 314c0-28 22-50 50-50s50 22 50 50c0 38-50 80-50 80s-50-42-50-80Z" fill="#26A878"/>
    <circle cx="840" cy="314" r="17" fill="#FFFFFF"/>
    <path d="m621 326 18 18 37-44" fill="none" stroke="#D93072" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

export async function generateSafeStoreListingGraphics({ outputDir = SAFE_STORE_LISTING_GRAPHICS_DIR } = {}) {
  const targetDir = resolve(outputDir);
  await mkdir(targetDir, { recursive: true });

  const iconPath = resolve(targetDir, "play-icon-512.png");
  await sharp(Buffer.from(ICON_SVG))
    .flatten({ background: "#F7B8D2" })
    .ensureAlpha(1)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
    .toFile(iconPath);

  const featurePath = resolve(targetDir, "play-feature-graphic-1024x500.png");
  await sharp(Buffer.from(FEATURE_SVG))
    .flatten({ background: "#FFF1F6" })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
    .toFile(featurePath);

  return [iconPath, featurePath];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = await generateSafeStoreListingGraphics();
  process.stdout.write(`Play 안전 대표 자산 ${files.length}개 생성 완료: ${SAFE_STORE_LISTING_GRAPHICS_DIR}\n`);
}
