import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const onboarding = readFileSync("src/screens/onboarding/Onboarding.tsx", "utf8");

assert.match(
  onboarding,
  /adoptNativeLocationSessionTokens/,
  "아이 모드 진입 전에 네이티브 기존 세션을 먼저 복구해야 합니다",
);
assert.match(
  onboarding,
  /routeAfterChildSession/,
  "복구된 아이 세션은 다시 클릭하지 않아도 아이 홈 또는 페어링으로 라우팅되어야 합니다",
);
assert.match(
  onboarding,
  /setChildStarting\(true\)/,
  "아이 모드 첫 탭 후 진행 중 상태를 즉시 표시해 중복 클릭을 유도하지 않아야 합니다",
);
assert.match(
  onboarding,
  /childStarting \? "준비 중…" : "부모님 코드로 시작"/,
  "아이 역할 카드에는 첫 탭 후 준비 중 문구가 보여야 합니다",
);

console.log("childRoleSingleTap contract ok");
