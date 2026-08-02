import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const identityPath = "src/lib/native/deviceIdentity.ts";
assert.ok(existsSync(identityPath), "아이 재연결용 기기 식별 힌트 모듈이 필요합니다");

const identity = readFileSync(identityPath, "utf8");
const familyApi = readFileSync("src/lib/api/endpoints/family.ts", "utf8");
const onboarding = readFileSync("src/screens/onboarding/Onboarding.tsx", "utf8");
const workerFamily = readFileSync("C:/Users/TK/Desktop/hyeni-3/worker/routes/family.ts", "utf8");

assert.match(identity, /readChildDeviceIdentityHint/);
assert.match(identity, /deviceInstallId/);
assert.match(identity, /previousUserId/);
assert.match(identity, /getPushContext/);

assert.match(
  familyApi,
  /JoinFamilyOptions/,
  "joinFamily 는 이름 외에 기기 식별 힌트를 받을 수 있어야 합니다",
);
assert.match(familyApi, /device_install_id/);
assert.match(familyApi, /previous_user_id/);
assert.match(onboarding, /readChildDeviceIdentityHint/);
assert.match(onboarding, /joinFamily\(code,\s*childJoinHint/);

assert.match(
  workerFamily,
  /previousUserId/,
  "Worker join 은 이전 child user_id 힌트를 처리해야 합니다",
);
assert.match(workerFamily, /deviceInstallId/);
assert.match(workerFamily, /reuseExistingChild/);
assert.match(
  workerFamily,
  /buildFreshSession\(c\.env,\s*sessionUserId\)/,
  "기존 아이로 판정되면 새 익명 user가 아니라 기존 child user_id로 세션을 재발급해야 합니다",
);

console.log("childRejoinIdentity contract ok");
