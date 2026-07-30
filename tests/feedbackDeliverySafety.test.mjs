import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const endpoint = await readFile(
  new URL("../src/lib/api/endpoints/feedback.ts", import.meta.url),
  "utf8",
);
const screen = await readFile(
  new URL("../src/screens/feature/Feedback.tsx", import.meta.url),
  "utf8",
);
const screenCss = await readFile(
  new URL("../src/screens/feature/Feedback.css", import.meta.url),
  "utf8",
);
const routes = await readFile(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const roleGuard = await readFile(
  new URL("../src/auth/RequireRole.tsx", import.meta.url),
  "utf8",
);

test("피드백 API는 인증 세션을 쓰고 클라이언트가 주장한 발신자 PII를 보내지 않는다", () => {
  assert.match(endpoint, /requestId:\s*string/);
  assert.match(endpoint, /familyId:\s*string\s*\|\s*null/);
  assert.match(endpoint, /content:\s*string/);
  assert.match(endpoint, /appOrigin:\s*string/);
  assert.doesNotMatch(endpoint, /senderUserId|senderRole|senderName|senderEmail/);
  assert.match(endpoint, /requestId:\s*input\.requestId/);
});

test("서버 sent와 queued 상태를 구분하고 레거시 mock도 queued로 정직하게 강등한다", () => {
  assert.match(endpoint, /status:\s*"queued"\s*\|\s*"sent"/);
  assert.match(endpoint, /body\.status === "sent" \|\| body\.status === "queued"/);
  assert.match(endpoint, /body\.mock \? "queued" : "sent"/);
  assert.doesNotMatch(endpoint, /mode:\s*"mock"\s*\|\s*"edge"/);
});

test("화면은 한 번 만든 requestId를 실패 재시도에도 유지하고 결과별 접수 문구를 보여준다", () => {
  assert.match(screen, /const \[requestId\] = useState\(createFeedbackRequestId\)/);
  assert.match(screen, /requestId,\s*\n\s*content/);
  assert.match(screen, /result\.status === "sent"/);
  assert.match(screen, /소중한 의견을 전달했어요/);
  assert.match(screen, /의견을 안전하게 접수했어요\. 운영 대기열에 보관했어요/);
  assert.match(screen, /maxLength=\{3000\}/);
  assert.doesNotMatch(screen, /senderUserId|senderRole|senderName|senderEmail/);
});

test("가짜 추천 집계 대신 선택한 관심 기능을 실제 피드백 본문에 함께 담는다", () => {
  assert.doesNotMatch(screen, /votes:\s*(?:128|94|67)|명이 원해요|추천 많은 순/);
  assert.match(screen, /관심 있는 기능을 선택하면 의견에 함께 적어 보내요/);
  assert.match(screen, /const selectedIdeaLabels = IDEAS\.filter/);
  assert.match(screen, /\[관심 기능\]/);
  assert.match(screen, /선택한 기능을 의견에 함께 담았어요/);
});

test("feedback 화면은 인증 가드 아래에만 있고 JSX 직접 색상값을 쓰지 않는다", () => {
  assert.match(roleGuard, /export function RequireAuthenticated\(\)/);
  assert.match(routes, /element:\s*<RequireAuthenticated\s*\/>[\s\S]*path:\s*"feedback"/);
  assert.doesNotMatch(routes, /\/\/ 역할 공용 푸시\/상세[\s\S]{0,120}\{ path: "feedback"/);
  // 색상은 전부 토큰이어야 한다 — JSX 에 원시 hex 가 하나도 없는지로 검사한다
  // (특정 토큰 이름을 고정하면 대비 개선으로 토큰이 바뀔 때 의도와 무관하게 깨진다).
  assert.doesNotMatch(screen, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(screenCss, /#[0-9a-f]{3,8}/i);
  // 칩은 미선택 = 중립 채움 + 보조 글자, 선택 = accent soft 채움 + 대비 맞춘 accent 글자.
  assert.match(screen, /var\(--bg-chip-idle\)/);
  assert.match(screen, /var\(--fg-tertiary\)/);
  assert.match(screen, /var\(--hy-accent-soft\)/);
  assert.match(screen, /var\(--hy-accent-text\)/);
  // 파스텔 채움 위 흰 글자는 2.8:1 미만이라 이 화면에서 다시 등장해선 안 된다.
  assert.doesNotMatch(screen, /background:\s*"var\(--hy-accent\)"/);
});
