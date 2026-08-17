import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("v1.3.0 선생님 모드는 개발 빌드에서만 열리고 환경변수로 프로덕션 우회하지 않는다", () => {
  const releaseFeatures = readSource("src/config/releaseFeatures.ts");
  assert.match(
    releaseFeatures,
    /TEACHER_MODE_ENABLED\s*=\s*import\.meta\.env\.DEV/,
  );
  assert.doesNotMatch(releaseFeatures, /VITE_.*TEACHER|import\.meta\.env\.PROD\s*\?/);
});

test("프로덕션 라우트와 역할 선택은 선생님 기능 대신 출시 안내 gate를 사용한다", () => {
  const app = readSource("src/app/App.tsx");
  const onboarding = readSource("src/screens/onboarding/Onboarding.tsx");

  assert.match(app, /TEACHER_MODE_ENABLED\s*\?\s*\[/);
  assert.match(app, /path:\s*"teacher\/\*"[^\n]*<TeacherReleaseGate\s*\/>/);
  assert.match(onboarding, /\{TEACHER_MODE_ENABLED\s*&&\s*\(/);
  assert.match(onboarding, /ob-role-card--teacher/);
});

test("기존 선생님 세션은 막힌 화면에서도 로그아웃·회원 탈퇴·법적 문서에 접근할 수 있다", () => {
  const gate = readSource("src/screens/teacher/TeacherReleaseGate.tsx");
  const koShared = JSON.parse(readSource("locales/ko/shared.json"));
  assert.match(gate, /shared\.teacherReleaseGate\.title/);
  assert.equal(koShared["shared.teacherReleaseGate.title"], "선생님 모드는 준비 중이에요");
  assert.match(gate, /logout\(\)/);
  assert.match(gate, /deleteAccount\(\)/);
  assert.match(gate, /PRIVACY_POLICY_URL/);
  assert.match(gate, /TERMS_OF_SERVICE_URL/);
  assert.match(gate, /aria-modal="true"/);
});

test("부모·아이 공용 준비물 화면은 미인증과 선생님 세션에서 열리지 않는다", () => {
  const app = readSource("src/app/App.tsx");
  const guards = readSource("src/auth/RequireRole.tsx");

  assert.match(guards, /export function RequireAnyRole/);
  assert.match(guards, /roles\.includes\(auth\.role\)/);
  assert.match(app, /<RequireAnyRole roles=\{\["parent", "child"\]\}\s*\/>/);

  const familyRoleStart = app.indexOf("// 부모·아이 공용 상세");
  const skeletonStart = app.indexOf("// 앱레벨 골격 화면");
  assert.ok(familyRoleStart >= 0 && skeletonStart > familyRoleStart);
  assert.ok(app.slice(familyRoleStart, skeletonStart).includes('path: "supplies"'));
});
