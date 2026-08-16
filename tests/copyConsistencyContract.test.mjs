import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const read = (path) => readFileSync(path, "utf8");
const TSX_FILES = execSync("git ls-files src", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((path) => path.endsWith(".tsx"));

test("사용자 노출 문구는 승인한 띄어쓰기와 제품 용어를 유지한다", () => {
  const forbidden = [
    "입력해주세요",
    "알려주세요",
    "골라주세요",
    "확인해주세요",
    "말해보세요",
    "더해보세요",
    "보내보세요",
    "지금 한번",
    "다시 한번",
    "잠금화면",
    "잠금해제",
    "오늘 이동경로",
    "사용시간",
    "월구독",
    "heads-up",
    "부모님에게",
    "엄마 아빠",
    "준비완료",
    "일찍왔어",
    "푹쉬어요",
    "위험 구역",
    "위험장소 알림",
    "Play 가격 확인",
  ];
  const offenders = [];

  for (const path of TSX_FILES) {
    const source = read(path);
    for (const phrase of forbidden) {
      if (source.includes(phrase)) offenders.push(`${path}: ${phrase}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("공용 오류·권한·업데이트·피드백 UI는 아이 말투 분기를 가진다", () => {
  for (const path of [
    "src/app/ErrorBoundary.tsx",
    "src/app/GlobalErrorListeners.tsx",
    "src/components/ui/OfflineBanner.tsx",
    "src/queries/QueryProvider.tsx",
    "src/screens/feature/PermDenied.tsx",
    "src/screens/feature/AppUpdate.tsx",
    "src/screens/feature/Feedback.tsx",
    "src/components/KakaoMap.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /child/, `${path}에 아이 역할 문구 분기가 필요해요`);
  }
});

test("동적 이름 뒤 조사는 기존 받침 판정 유틸을 사용한다", () => {
  const cases = [
    ["src/screens/feature/FamilyConnection.tsx", /hasJongseong\(connected\[0\]\.name \|\| "아이"\)/],
    ["src/screens/feature/SosReceive.tsx", /hasJongseong\(childName\)/],
    ["src/screens/child/AiFriendChat.tsx", /hasJongseong\(friendName\)/],
  ];

  for (const [path, pattern] of cases) {
    assert.match(read(path), pattern, `${path}의 동적 조사 선택이 고정되면 안 돼요`);
  }
});

test("파생 문구도 잠금 화면·월간 구독·말줄임표 표기를 유지한다", () => {
  const notification = read("src/transform/deviceNotificationHealth.ts");
  assert.doesNotMatch(notification, /잠금화면|heads-up/);
  assert.match(notification, /잠금 화면/);
  assert.match(notification, /화면 상단 팝업/);

  const entitlement = read("src/transform/entitlement.ts");
  assert.match(entitlement, /프리미엄 월간 구독/);
  assert.doesNotMatch(entitlement, /프리미엄 월구독/);

  const memo = read("src/transform/memoChatCopy.ts");
  const koShared = JSON.parse(read("locales/ko/shared.json"));
  assert.doesNotMatch(memo, /메시지를 입력(?:하세요|해 줘)\.\.\./);
  assert.equal(koShared["shared.memo.copy.inputPlaceholder.formal"], "메시지를 입력하세요…");
  assert.equal(koShared["shared.memo.copy.inputPlaceholder.child"], "메시지를 입력해 줘…");
  assert.match(memo, /shared\.memo\.copy\.\$\{field\}\.\$\{tone\}/);

  const memoScreen = read("src/screens/shared/MemoChat.tsx");
  assert.match(memoScreen, /savingPhoto \? intl\.formatMessage\(\{ id: "shared\.memoChat\.copy047" \}\) : intl\.formatMessage\(\{ id: "shared\.memoChat\.copy048" \}\)/);
  assert.equal(koShared["shared.memoChat.copy047"], "저장 중…");
  assert.equal(koShared["shared.memoChat.copy048"], "저장");
});
