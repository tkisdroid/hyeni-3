import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  endpoint,
  diagnostics,
  diagnosticTransform,
  screen,
  screenCss,
  routes,
  roleGuard,
  errorBoundary,
  parentSettings,
  childSettings,
  teacherSettings,
  operations,
] = await Promise.all([
  read("src/lib/api/endpoints/feedback.ts"),
  read("src/lib/feedbackDiagnostics.ts"),
  read("src/transform/feedbackDiagnostics.ts"),
  read("src/screens/feature/Feedback.tsx"),
  read("src/screens/feature/Feedback.css"),
  read("src/app/App.tsx"),
  read("src/auth/RequireRole.tsx"),
  read("src/app/ErrorBoundary.tsx"),
  read("src/screens/parent/ParentSettings.tsx"),
  read("src/screens/child/ChildSettings.tsx"),
  read("src/screens/teacher/TeacherSettings.tsx"),
  read("docs/feedback-operations.md"),
]);
const koCore = JSON.parse(await read("locales/ko/core.json"));

test("피드백 API는 인증 세션을 쓰고 클라이언트가 주장한 발신자 PII를 보내지 않는다", () => {
  assert.match(endpoint, /requestId:\s*string/);
  assert.match(endpoint, /familyId:\s*string\s*\|\s*null/);
  assert.match(endpoint, /feedbackKind:\s*FeedbackKind/);
  assert.match(endpoint, /category:\s*FeedbackCategory\s*\|\s*null/);
  assert.match(endpoint, /content:\s*string/);
  assert.match(endpoint, /appOrigin:\s*string/);
  assert.doesNotMatch(endpoint, /senderUserId|senderRole|senderName|senderEmail/);
  assert.match(endpoint, /requestId:\s*input\.requestId/);
  assert.match(endpoint, /diagnosticSchemaVersion:\s*input\.diagnostics\.schemaVersion/);
  assert.match(endpoint, /currentScreen:\s*input\.diagnostics\.currentScreen/);
  assert.match(endpoint, /deviceInfo:\s*input\.diagnostics\.deviceInfo/);
  assert.match(endpoint, /errorLogs:\s*input\.diagnostics\.errorLogs/);
});

test("서버 sent와 queued 상태를 구분하고 레거시 mock도 queued로 정직하게 강등한다", () => {
  assert.match(endpoint, /status:\s*"queued"\s*\|\s*"sent"/);
  assert.match(endpoint, /body\.status === "sent" \|\| body\.status === "queued"/);
  assert.match(endpoint, /body\.mock \? "queued" : "sent"/);
  assert.doesNotMatch(endpoint, /mode:\s*"mock"\s*\|\s*"edge"/);
});

test("문제 신고는 한 번 만든 requestId와 입력 내용을 실패 재시도에도 유지한다", () => {
  assert.match(screen, /const \[requestId\] = useState\(createFeedbackRequestId\)/);
  assert.match(screen, /const \[feedbackKind, setFeedbackKind\] = useState<FeedbackKind>\("problem"\)/);
  assert.match(screen, /requestId,\s*\n\s*feedbackKind,\s*\n\s*category,\s*\n\s*content/);
  assert.match(screen, /result\.status === "sent"/);
  assert.match(screen, /내용을 전달했어요/);
  assert.match(screen, /내용을 안전하게 접수했어요\. 운영 대기열에 보관했어요/);
  assert.match(screen, /maxLength=\{3000\}/);
  assert.doesNotMatch(screen, /setText\(""\)|senderUserId|senderRole|senderName|senderEmail/);
  assert.doesNotMatch(screen, /rating|required.*평점|votes:\s*(?:128|94|67)|명이 원해요/);
});

test("진단 첨부는 명시적으로 끌 수 있고 성공 접수 뒤에만 로컬 오류를 비운다", () => {
  assert.match(screen, /const \[includeDiagnostics, setIncludeDiagnostics\] = useState\(true\)/);
  assert.match(screen, /includeDiagnostics \? await collectFeedbackDiagnostics\(\) : null/);
  assert.match(screen, /if \(includeDiagnostics\) clearFeedbackDiagnostics\(\)/);
  assert.match(screen, /진단 정보에는 대화 내용·위치 좌표·사진·비밀번호·로그인 토큰을 포함하지 않아요/);
  assert.match(diagnostics, /FEEDBACK_DIAGNOSTIC_EVENT_LIMIT/);
  assert.match(diagnosticTransform, /FEEDBACK_DIAGNOSTIC_EVENT_LIMIT = 12/);
  assert.match(diagnosticTransform, /FEEDBACK_DIAGNOSTIC_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(diagnostics, /\blatitude\b|\blongitude\b|\baccessToken\b|\brefreshToken\b|\bpassword\b/);
});

test("부모·아이·선생님 설정과 크래시 화면에서 피드백 화면으로 바로 갈 수 있다", () => {
  assert.match(parentSettings, /label:\s*"문제 신고 · 문의"[\s\S]*navigate\("\/feedback"\)/);
  assert.match(childSettings, /navigate\("\/feedback"\)[\s\S]*문제 알려주기/);
  assert.match(teacherSettings, /navigate\("\/feedback"\)[\s\S]*문제 신고 · 문의/);
  assert.match(errorBoundary, /window\.location\.hash = "#\/feedback"/);
  assert.match(errorBoundary, /"core\.action\.reportProblem\.child" : "core\.action\.reportProblem\.formal"/);
  assert.equal(koCore["core.action.reportProblem.child"], "문제 알려주기");
  assert.equal(koCore["core.action.reportProblem.formal"], "문제 신고하기");
});

test("운영 가이드는 본문을 먼저 열지 않고 requestId·오류 빈도·queued부터 확인한다", () => {
  assert.match(operations, /wrangler d1 execute hyeni-calendar --remote --json/);
  assert.match(operations, /json_extract\(message, '\$\.requestId'\) AS request_id/);
  assert.match(operations, /json_each\(CASE WHEN json_valid\(f\.error_logs\)/);
  assert.match(operations, /status = 'queued'/);
  assert.match(operations, /wrangler tail hyeni-calendar-api --format pretty/);
  assert.match(operations, /status='sent'.*Resend 전달 완료/s);
  assert.doesNotMatch(operations, /SELECT\s+\*/i);
  assert.doesNotMatch(operations, /access_token|refresh_token|purchase_token/i);
});

test("feedback 화면은 인증 가드 아래에만 있고 고대비 디자인 토큰을 사용한다", () => {
  assert.match(roleGuard, /export function RequireAuthenticated\(\)/);
  assert.match(routes, /element:\s*<RequireAuthenticated\s*\/>[\s\S]*path:\s*"feedback"/);
  assert.doesNotMatch(routes, /\/\/ 역할 공용 푸시\/상세[\s\S]{0,120}\{ path: "feedback"/);
  assert.doesNotMatch(screen, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(screenCss, /#[0-9a-f]{3,8}/i);
  assert.match(screenCss, /\.fb-cat\s*\{[\s\S]*background:\s*var\(--bg-chip-idle\)/);
  assert.match(screenCss, /\.fb-cat\[data-selected="true"\]\s*\{[\s\S]*background:\s*var\(--hy-accent-soft\)[\s\S]*color:\s*var\(--hy-accent-text\)/);
  assert.match(screenCss, /\.fb-submit\s*\{[\s\S]*background:\s*var\(--cta-grad-accent\)/);
  assert.doesNotMatch(screenCss, /background:\s*var\(--hy-accent\)[\s\S]{0,100}color:\s*(?:white|#fff)/i);
});
