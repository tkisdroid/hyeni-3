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
    "src/maps/providers/kakao/KakaoMapAdapter.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /child/, `${path}에 아이 역할 문구 분기가 필요해요`);
  }
});

test("동적 이름의 한국어 조사는 ko 경로에서만 적용하고 AI 대화는 locale 카탈로그가 문장을 완성한다", () => {
  const familyConnection = read("src/screens/feature/FamilyConnection.tsx");
  const sosReceive = read("src/screens/feature/SosReceive.tsx");
  const aiChat = read("src/screens/child/AiFriendChat.tsx");
  const koChild = JSON.parse(read("locales/ko/child.json"));
  const nonKoreanLocales = ["en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

  assert.match(familyConnection, /resolveFamilyConnectionChildSubject\(\{[\s\S]*childName: connected\[0\]\?\.name[\s\S]*childFallback/);
  assert.doesNotMatch(familyConnection, /connected\[0\]\.name/);
  assert.match(sosReceive, /locale === "ko" \? `\$\{childName\}\$\{hasJongseong\(childName\)/);
  assert.match(aiChat, /child\.aiChat\.messageAria[\s\S]{0,100}\{ name: friendName \}/);
  assert.match(aiChat, /child\.aiChat\.placeholder[\s\S]{0,100}\{ name: friendName \}/);
  assert.doesNotMatch(aiChat, /hasJongseong\(friendName\)/);
  assert.equal(koChild["child.aiChat.messageAria"], "{name}에게 메시지");
  assert.equal(koChild["child.aiChat.placeholder"], "{name}에게 말해 봐…");

  for (const locale of nonKoreanLocales) {
    const catalog = JSON.parse(read(`locales/${locale}/child.json`));
    for (const id of ["child.aiChat.messageAria", "child.aiChat.placeholder"]) {
      assert.doesNotMatch(catalog[id], /\{name\}(?:이|가|을|를|은|는|과|와|에게)/, `${locale}:${id}`);
    }
  }
});

test("파생 문구도 잠금 화면·월간 구독·말줄임표 표기를 유지한다", () => {
  const notification = read("src/transform/deviceNotificationHealth.ts");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  assert.doesNotMatch(notification, /잠금화면|heads-up/);
  assert.match(koParent["parent.device.notification.fullScreenDisabledDetail"], /잠금 화면/);
  assert.match(koParent["parent.device.notification.fullScreenDisabledDetail"], /화면 상단 팝업/);

  // 플랜 라벨은 소스 문자열이 아니라 catalog 계약으로 지킨다(2026-08-25 planLabelId 이관).
  const entitlement = read("src/transform/entitlement.ts");
  assert.match(entitlement, /billing\.subscription\.plan\.monthly/);
  assert.doesNotMatch(entitlement, /프리미엄 월/);
  const koBilling = JSON.parse(read("locales/ko/billing.json"));
  assert.equal(koBilling["billing.subscription.plan.monthly"], "프리미엄 월간 구독");
  assert.equal(koBilling["billing.subscription.plan.annual"], "프리미엄 연간 구독");

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
