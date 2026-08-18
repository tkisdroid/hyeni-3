/**
 * TK 가 준 clay 3D 아이콘 세트(v3, 투명 PNG 25종)를 부모 설정 화면 자산으로 들여온다.
 *
 * 원본은 1024px 투명 PNG라 배경을 지울 필요가 없다 — 여백만 잘라 256px webp 로 줄인다.
 * 파일 이름 → 앱 slug 표가 이 스크립트의 정본이고, 화면은 slug 로만 참조한다.
 *
 * 사용: node scripts/import-clay-3d-icons.mjs "<원본 폴더>"
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT_DIR, "public", "assets", "ui", "clay");
const OUTPUT_SIZE = 256;
const WEBP_QUALITY = 88;

/** 원본 파일 → 앱 자산 이름(부모 설정 행 순서). */
export const CLAY_ICON_FILES = Object.freeze({
  "01_language_selection.png": "language.webp",
  "02_account_profile.png": "account.webp",
  "03_notification_settings.png": "notification.webp",
  "04_location_background.png": "location.webp",
  "05_data_sync.png": "data-sync.webp",
  "06_subscription_management.png": "subscription.webp",
  "07_friend_invite.png": "referral.webp",
  "08_child_management.png": "children.webp",
  "09_place_management.png": "places.webp",
  "10_friend_playdate.png": "playdate.webp",
  "11_remote_listen.png": "remote-audio.webp",
  "12_ambient_sound_history.png": "remote-audio-history.webp",
  "13_sticker_reward.png": "sticker.webp",
  "14_ai_friend_credits.png": "ai-credit.webp",
  "15_privacy_policy.png": "privacy.webp",
  "16_issue_report.png": "feedback.webp",
  "17_logout.png": "logout.webp",
  "18_location_marker.png": "pin.webp",
  "19_school_icon.png": "school.webp",
  "20_calendar.png": "calendar.webp",
  "21_background_location.png": "background-location.webp",
  "22_battery.png": "battery.webp",
  "23_recent_history_lookup.png": "history.webp",
  "24_download.png": "download.webp",
  "25_trash.png": "trash.webp",
});

async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("원본 폴더 경로가 필요합니다");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const report = [];
  for (const [file, output] of Object.entries(CLAY_ICON_FILES)) {
    const input = join(sourceDir, file);
    const metadata = await sharp(input).metadata();
    if (!metadata.hasAlpha) throw new Error(`${file}: 투명 배경이 아닙니다`);
    // 여백을 잘라 슬롯을 꽉 채우되 정사각 비율은 유지한다(칩 안에서 크기가 들쭉날쭉하지 않게).
    const trimmed = await sharp(input).trim({ threshold: 1 }).toBuffer();
    const info = await sharp(trimmed)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100 })
      .toFile(join(OUTPUT_DIR, output));
    report.push(`${output}\t${info.size}B`);
  }
  await writeFile(join(OUTPUT_DIR, "manifest.txt"), `${report.join("\n")}\n`, "utf8");
  const total = report.reduce((sum, line) => sum + Number(line.split("\t")[1].replace("B", "")), 0);
  console.log(`${report.length}종 · 합계 ${(total / 1024).toFixed(1)}KB`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
