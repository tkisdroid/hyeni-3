import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("부모 홈 바로가기는 핵심 서비스 순서와 실제 라우트를 일관되게 유지한다", () => {
  const home = readSource("src/screens/parent/ParentHome.tsx");
  const mock = readSource("src/data/mock.ts");

  const labels = [...mock.matchAll(/label: "([^"]+)"/g)]
    .map((m) => m[1])
    .filter((label) => ["AI 일정", "위치추적", "친구놀이", "장소관리", "주변소리", "안심리포트", "아이 기기 찾기", "알림"].includes(label));

  assert.deepEqual(labels, ["AI 일정", "위치추적", "친구놀이", "장소관리", "주변소리", "안심리포트", "아이 기기 찾기", "알림"]);
  assert.match(home, /"AI 일정": "\/ai-schedule\?tab=text"/);
  assert.match(home, /"위치추적": "\/parent\/location\?view=history"/);
  assert.match(home, /"친구놀이": "\/friend-play"/);
  assert.match(home, /"안심리포트": "\/daily-report"/);
  assert.match(home, /"아이 기기 찾기": "\/remote-ring"/);
  assert.match(home, /"알림": "\/notifications"/);
});

test("부모 메뉴 아이콘과 바로가기 색상은 토큰 기반으로 유지한다", () => {
  const settings = readSource("src/screens/parent/ParentSettings.tsx");
  const mock = readSource("src/data/mock.ts");
  const shortcutsBlock = mock.slice(mock.indexOf("export const shortcuts"));

  assert.doesNotMatch(settings, /emoji:/);
  assert.doesNotMatch(settings, /chipBg:/);
  // 설정 행 아이콘은 clay 3D webp 로 통일했다(2026-08-18 TK 지시) — 남은 lucide 는 이동·모달 글리프뿐이다.
  assert.match(settings, /ui\/clay\/account\.webp/);
  assert.match(settings, /asset\(icon\)/);
  assert.match(settings, /data-tone=\{tone\}/);
  assert.match(settings, /data-tone=\{f\.tone\}/);
  assert.doesNotMatch(shortcutsBlock, /#[0-9A-Fa-f]{3,8}/);
  assert.doesNotMatch(shortcutsBlock, /rgba\(/);
  assert.match(shortcutsBlock, /var\(--lav-soft\)/);
  assert.match(shortcutsBlock, /color-mix\(in srgb, var\(--blue-500\) 16%, transparent\)/);
});

test("부모 위치 시트의 액션 버튼은 원시 이모지 대신 아이콘/에셋을 쓴다", () => {
  const location = readSource("src/screens/parent/ParentLocation.tsx");
  const css = readSource("src/screens/parent/ParentLocation.css");
  const koParent = JSON.parse(readSource("locales/ko/parent.json"));
  const actions = location.slice(
    location.indexOf('<div className="pl-actions">'),
    location.indexOf("</div>", location.indexOf('className="pl-call-btn')),
  );

  assert.ok(actions.length > 0, "pl-actions 블록을 찾지 못했다");
  // 원시 이모지는 시스템 폰트로 렌더돼 크기·베이스라인이 옆 아이콘과 어긋난다.
  assert.doesNotMatch(actions, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  // 네 액션은 부모 화면 전체와 같은 소프트 3D 질감으로 맞춘다.
  assert.match(actions, /ui\/chat-heart\.webp/);
  assert.match(actions, /ui\/clay\/location\.webp/);
  assert.match(actions, /ui\/clay\/remote-audio\.webp/);
  assert.match(actions, /ui\/phone-lavender\.webp/);
  assert.match(css, /\.pl-route-btn \{[^}]*background: var\(--blue-soft\)/);
  // 4열 퀵액션은 아이콘마다 라벨을 함께 보여준다(처음 쓰는 부모도 뜻을 안다).
  const labels = {
    "parent.eventForm.copy060": "메모",
    "parent.parentLocation.copy054": "경로",
    "parent.home.shortcut.remoteAudio": "주변소리",
    "parent.parentLocation.copy057": "전화",
  };
  for (const [id, label] of Object.entries(labels)) {
    assert.match(actions, new RegExp(`className="pl-actions__label"[^>]*>[\\s\\S]{0,100}${id}`));
    assert.equal(koParent[id], label);
  }
  assert.match(css, /\.pl-actions \{[^}]*grid-template-columns: repeat\(4, 1fr\)/s);
});

test("아이콘 자리 원시 이모지 금지 — 긴급수신·캘린더·선생님설정(2026-07-11 감사 반영)", () => {
  const sos = readSource("src/screens/feature/SosReceive.tsx");
  assert.doesNotMatch(sos, /🚨|🆘/u);

  const cal = readSource("src/screens/parent/ParentCalendar.tsx");
  assert.doesNotMatch(cal, /📝/u);

  const ts = readSource("src/screens/teacher/TeacherSettings.tsx");
  // 칩 아이콘은 부모 설정과 같은 lucide + data-tone 패턴만.
  assert.doesNotMatch(ts, /__chip"[^>]*>\s*[\u{1F300}-\u{1FAFF}]/u);
  assert.match(ts, /data-tone="rose"><Bell/);
});
