/**
 * 아이콘·이미지 일관성 가드 (2026-07-14 전수조사).
 *
 * 규칙:
 *  1. 진한 선(line) 스타일 플랫 SVG(ui/icon-*.svg)를 화면에 다시 들여오지 않는다.
 *     - 기능 타일/칩/히어로 = 소프트 3D webp(menu-*, place-*, *-3d 등)
 *     - 텍스트 행 인라인/유틸리티 = lucide-react
 *  2. 안전지표(부모 홈·안심리포트)는 배터리와 같은 3D webp 언어로 4칸 전부 통일한다.
 *  3. 전용 아이콘 슬롯(칩·배지·행 아이콘)에 원시 유니코드 이모지를 쓰지 않는다.
 *     (문장 안 이모지·토스트 장식·아이 SOS 감정 표현은 별개 규칙으로 허용)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

test("플랫 라인 SVG(ui/icon-*.svg)는 src 어디에서도 참조하지 않는다", () => {
  const offenders = [];
  for (const file of walk(resolve(rootDir, "src"))) {
    const body = readFileSync(file, "utf8");
    if (/ui\/icon-[a-z-]+\.svg/.test(body)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `플랫 SVG 참조 금지: ${offenders.join(", ")}`);
});

test("교체용 3D 아이콘 에셋이 존재한다", () => {
  for (const name of [
    "clock-3d.webp",
    "wifi-3d.webp",
    "lock-3d.webp",
    "lock-open-3d.webp",
    "chart-3d.webp",
    "ai-robot.webp",
    "mic-lavender.webp",
    "battery.webp",
  ]) {
    assert.ok(existsSync(resolve(rootDir, "public/assets/ui", name)), `missing public/assets/ui/${name}`);
  }
});

test("부모 홈 안전지표 4칸은 전부 3D webp 아이콘을 쓴다", () => {
  const home = readSource("src/screens/parent/ParentHome.tsx");
  assert.match(home, /ui\/battery\.webp/);
  assert.match(home, /ui\/clock-3d\.webp/);
  assert.match(home, /ui\/lock-open-3d\.webp/);
  assert.match(home, /ui\/wifi-3d\.webp/);
});

test("안심리포트 기기 상태 그리드도 3D webp 4종으로 통일한다", () => {
  const report = readSource("src/screens/feature/DailySafetyReport.tsx");
  assert.match(report, /ui\/battery\.webp/);
  assert.match(report, /ui\/clock-3d\.webp/);
  assert.match(report, /ui\/lock-open-3d\.webp/);
  assert.match(report, /ui\/wifi-3d\.webp/);
});

test("프리미엄 잠금·주간 리포트 히어로는 3D webp를 쓴다", () => {
  const weekly = readSource("src/screens/feature/WeeklyFamilyReport.tsx");
  const location = readSource("src/screens/parent/ParentLocation.tsx");
  assert.match(weekly, /ui\/chart-3d\.webp/);
  assert.match(weekly, /ui\/lock-3d\.webp/);
  assert.match(location, /ui\/lock-3d\.webp/);
});

test("PNG 중복 에셋(ai-robot·mic-lavender)은 webp 참조만 남긴다", () => {
  for (const file of walk(resolve(rootDir, "src"))) {
    const body = readFileSync(file, "utf8");
    assert.doesNotMatch(body, /ai-robot\.png|mic-lavender\.png/, `${file} 에 PNG 참조가 남아 있음`);
  }
});

test("전용 아이콘 슬롯에 원시 이모지를 쓰지 않는다 (2026-07-14 전수조사)", () => {
  const slots = [
    ["src/screens/feature/AiCredit.tsx", /className="ac-(note__emoji|auto__icon)">\s*[^\s<]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["src/screens/feature/AiSchedule.tsx", /className="ais-(hint__ico|reslabel__badge)">\s*[^\s<]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["src/screens/shared/MemoChat.tsx", /className="mc-loc-ic">\s*[^\s<]*[\u{1F300}-\u{1FAFF}]/u],
    ["src/screens/child/StickerBook.tsx", /className="sb-slot__lock"[^>]*>\s*[\u{1F300}-\u{1FAFF}]/u],
    ["src/components/QrScanner.tsx", /className="qrs-title">\s*[\u{1F300}-\u{1FAFF}]/u],
    ["src/screens/teacher/TeacherStudents.tsx", /className="ts-hint__ico">\s*[\u{1F300}-\u{1FAFF}]/u],
    ["src/screens/teacher/TeacherTimetable.tsx", /className="tt-note__ico">\s*[\u{1F300}-\u{1FAFF}]/u],
    ["src/screens/onboarding/Onboarding.tsx", /className="ob-(teacher-note__ic|qr-cta)">\s*[\u{1F300}-\u{1FAFF}]/u],
    ["src/screens/parent/EventForm.tsx", /is_home \? "\u{1F3E0}" : "\u{1F4CD}"|`\u{1F3E0} \$\{|`\u{1F4CD} \$\{/u],
    ["src/components/MapPickerSheet.tsx", /is_home \? "\u{1F3E0}" : "\u{1F4CD}"/u],
  ];
  for (const [file, pattern] of slots) {
    assert.doesNotMatch(readSource(file), pattern, `${file} 아이콘 슬롯에 원시 이모지`);
  }
});

test("출시 화면 유틸리티 아이콘은 손작성 SVG나 전용 슬롯 이모지를 쓰지 않는다", () => {
  const parentLocation = readSource("src/screens/parent/ParentLocation.tsx");
  assert.doesNotMatch(
    parentLocation,
    /<svg\b[\s\S]*?<\/svg>/,
    "ParentLocation 유틸리티 아이콘은 lucide-react를 사용해야 함",
  );

  const dedicatedSlots = [
    ["src/screens/feature/DaySummary.tsx", /icon:\s*["'][^"']*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["src/screens/feature/RemoteAudio.tsx", /icon:\s*["'][^"']*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["src/screens/feature/FriendPlay.tsx", /className="fp-(setting__icon|connected__badge)"[^>]*>\s*[^<{]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["src/screens/feature/RemoteRing.tsx", /className="rr-modal-emoji"[^>]*>\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["src/screens/parent/ParentLocation.tsx", /<span>\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*일정\s*<\/span>/u],
  ];

  for (const [file, pattern] of dedicatedSlots) {
    assert.doesNotMatch(readSource(file), pattern, `${file} 전용 슬롯에 원시 이모지`);
  }
});

test("장소 삭제 아이콘은 44px 조작 영역과 18px 이하 glyph를 유지한다", () => {
  const css = readSource("src/screens/feature/PlaceManager.css");
  const screen = readSource("src/screens/feature/PlaceManager.tsx");

  for (const selector of ["pm-item__del", "pm-danger__del"]) {
    assert.match(
      css,
      new RegExp(`\\.${selector}[\\s\\S]*?min-height:\\s*var\\(--control-min-size\\)`),
      `${selector} 최소 높이 44px 계약 누락`,
    );
    assert.match(
      css,
      new RegExp(`\\.${selector}[\\s\\S]*?min-width:\\s*var\\(--control-min-size\\)`),
      `${selector} 최소 너비 44px 계약 누락`,
    );
  }
  assert.doesNotMatch(screen, /<Trash2\s+size=\{(?:19|[2-9]\d)\}/, "삭제 glyph가 18px를 초과함");
});
