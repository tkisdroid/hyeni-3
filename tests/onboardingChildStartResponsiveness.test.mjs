import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const onboarding = readFileSync(
  new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url),
  "utf8",
).replace(/\r\n?/g, "\n");

test("아이로 시작은 기기·네트워크 준비를 기다리기 전에 연결 화면을 연다", () => {
  const start = onboarding.indexOf("const startChildMode = async");
  const end = onboarding.indexOf("\n\n  return (", start);
  assert.ok(start >= 0 && end > start, "startChildMode 함수를 찾지 못했습니다");

  const flow = onboarding.slice(start, end);
  const authenticatedGuardAt = flow.indexOf('current.status === "authenticated"');
  const roleAt = flow.indexOf('setRole("child")');
  const pairModeAt = flow.indexOf('setPairMode("child")');
  const pairingScreenAt = flow.indexOf('setStep("pairing")');
  const firstDeviceWaitAt = flow.indexOf("await readChildDeviceIdentityHint()");

  assert.ok(authenticatedGuardAt >= 0, "기존 인증 세션 보호 가드가 필요합니다");
  assert.ok(roleAt > authenticatedGuardAt, "기존 세션을 확인한 뒤 아이 역할을 선택해야 합니다");
  assert.ok(pairModeAt > roleAt, "아이 페어링 모드를 명시해야 합니다");
  assert.ok(pairingScreenAt > pairModeAt, "아이 연결 화면으로 전환해야 합니다");
  assert.ok(firstDeviceWaitAt > pairingScreenAt, "네이티브 준비 때문에 카드 반응이 지연되면 안 됩니다");
  assert.match(
    flow,
    /catch \(e\) \{[\s\S]*deriveAuthState\(\)[\s\S]*status !== "authenticated"[\s\S]*setStep\("role"\)/,
    "세션 준비 실패 뒤에는 동작하지 않는 연결 화면에 남지 않고 역할 화면에서 재시도해야 합니다",
  );
});

test("아이 세션 준비 중에는 연결 화면에서 뒤로가기로 진행 작업을 이탈하지 않는다", () => {
  const start = onboarding.indexOf("function PairingStep({");
  const end = onboarding.indexOf("function PermsStep(", start);
  assert.ok(start >= 0 && end > start, "PairingStep 함수를 찾지 못했습니다");

  const pairingStep = onboarding.slice(start, end);
  assert.match(pairingStep, /<BackButton onBack=\{onBack\} disabled=\{busy\} \/>/);
});

test("새 익명 아이 세션은 손상된 역할로 오인하지 않고 연결 화면에 유지한다", () => {
  const start = onboarding.indexOf("const routeAfterChildSession = () => {");
  const end = onboarding.indexOf("\n\n  const startChildMode", start);
  assert.ok(start >= 0 && end > start, "아이 세션 라우팅 함수를 찾지 못했습니다");

  const routing = onboarding.slice(start, end);
  assert.match(
    routing,
    /state\.isAnonymous[\s\S]*setRole\("child"\)[\s\S]*setPairMode\("child"\)[\s\S]*setStep\("pairing"\)[\s\S]*return true/,
    "익명 로그인 성공 직후에는 아이 연결 화면을 닫으면 안 됩니다",
  );
});
