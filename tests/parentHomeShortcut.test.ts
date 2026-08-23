import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortcuts } from "../src/data/mock.ts";
import { resolveParentHomeDeviceFinder } from "../src/transform/parentHomeShortcut.ts";

test("부모 홈 바로가기는 구독 대신 아이 기기 찾기를 4×2 그리드에 둔다", () => {
  assert.deepEqual(shortcuts.map((shortcut) => shortcut.label), [
    "AI 일정",
    "위치추적",
    "친구놀이",
    "장소관리",
    "주변소리",
    "안심리포트",
    "아이 기기 찾기",
    "알림",
  ]);
});

test("바로가기에 표시되는 이름은 실제 이동 대상과 같아야 한다", () => {
  // 2026-08-17 실제 결함: sc7 의 라벨 id 가 "구독"이라 아이 기기 찾기 타일에 '구독'이 찍혔다.
  const home = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
  const koParent = JSON.parse(
    readFileSync(new URL("../locales/ko/parent.json", import.meta.url), "utf8"),
  ) as Record<string, string>;

  const labelIds = new Map<string, string>();
  for (const [, id, messageId] of home.matchAll(/(sc\d+): "([a-zA-Z.]+)",/g)) {
    labelIds.set(id, messageId);
  }
  assert.equal(labelIds.size, shortcuts.length, "바로가기마다 라벨 id 가 있어야 한다");

  const routes = home.slice(home.indexOf("const shortcutRoutes"), home.indexOf("const shortcutLabelIds"));
  for (const shortcut of shortcuts) {
    const messageId = labelIds.get(shortcut.id);
    assert.ok(messageId, `${shortcut.id} 라벨 id 누락`);
    assert.equal(
      koParent[messageId],
      shortcut.label,
      `${shortcut.id} 표시 이름(${koParent[messageId]})이 이동 대상(${shortcut.label})과 다르다`,
    );
    assert.ok(routes.includes(`${shortcut.id}:`), `${shortcut.id} 라우트 매핑 누락`);
  }
  assert.match(home, /const openShortcut = \(id: string\)/);
  assert.match(home, /onClick=\{\(\) => openShortcut\(s\.id\)\}/);
});

test("아이 기기 찾기는 현재 활성 아이를 원격 벨 대상으로 명시한다", () => {
  assert.deepEqual(resolveParentHomeDeviceFinder("child-user-1"), {
    to: "/remote-ring",
    state: { childUserId: "child-user-1" },
  });
});

test("연결된 아이가 없을 때는 대상 식별자를 지어내지 않는다", () => {
  assert.deepEqual(resolveParentHomeDeviceFinder(null), {
    to: "/remote-ring",
    state: { childUserId: undefined },
  });
});

test("연결된 아이가 없는 부모 홈은 아이 연결 화면으로 바로 복구시킨다", () => {
  const home = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
  const childSection = home.slice(home.indexOf("{/* 아이 현황 */}"), home.indexOf("{/* 안전 지표 */}"));
  const loadingAt = childSection.indexOf("familyQuery.isLoading");
  const errorAt = childSection.indexOf("familyQuery.isError");
  const emptyAt = childSection.indexOf("childCards.length === 0");

  assert.ok(loadingAt >= 0 && loadingAt < emptyAt, "가족 조회 중에는 아이 없음으로 단정하면 안 된다");
  assert.ok(errorAt >= 0 && errorAt < emptyAt, "가족 조회 실패를 아이 없음으로 위장하면 안 된다");
  assert.match(childSection, /familyQuery\.refetch\(\)/);
  assert.match(
    childSection,
    /childCards\.length === 0[\s\S]{0,500}navigate\("\/child-invite\?role=child"\)[\s\S]{0,180}shared\.stickerSend\.connectChild/,
  );
});
