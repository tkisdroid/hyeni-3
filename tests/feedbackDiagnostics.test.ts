import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFeedbackDiagnosticEvent,
  FEEDBACK_DIAGNOSTIC_EVENT_LIMIT,
  normalizeFeedbackDiagnosticCode,
  normalizeFeedbackDiagnosticPath,
  normalizeFeedbackDiagnosticSource,
  type FeedbackDiagnosticEvent,
} from "../src/transform/feedbackDiagnostics.ts";

test("진단 경로는 쿼리·해시·식별자 후보를 저장하지 않는다", () => {
  assert.equal(
    normalizeFeedbackDiagnosticPath(
      "/api/location/550e8400-e29b-41d4-a716-446655440000?token=secret#detail",
    ),
    "/api/location/:id",
  );
  assert.equal(
    normalizeFeedbackDiagnosticPath("/onboarding/KID-ABCDEF1234567890"),
    "/onboarding/:id",
  );
  assert.equal(normalizeFeedbackDiagnosticPath("/children/12345/location"), "/children/:n/location");
  assert.equal(normalizeFeedbackDiagnosticPath("/location/37.5123/127.0123"), "/location/:n/:n");
  assert.equal(normalizeFeedbackDiagnosticPath("/api/location/:id"), "/api/location/:id");
  assert.equal(normalizeFeedbackDiagnosticPath("/memo/아이 이름"), "/memo/:value");
});

test("오류 원문 문장은 버리고 안정적인 코드·클래스만 남긴다", () => {
  assert.equal(normalizeFeedbackDiagnosticCode({ code: "location_timeout" }), "location_timeout");
  assert.equal(normalizeFeedbackDiagnosticCode(new TypeError("민감한 사용자 문장")), "TypeError");
  assert.equal(normalizeFeedbackDiagnosticCode("API 503"), "http_503");
  assert.equal(normalizeFeedbackDiagnosticCode("secret"), "unexpected_error");
  assert.equal(normalizeFeedbackDiagnosticCode("사용자 메모 원문이 포함된 긴 오류입니다"), "unexpected_error");
  assert.equal(
    normalizeFeedbackDiagnosticSource(
      "https://localhost/assets/index-ABC123.js?token=secret",
      42,
      7,
    ),
    "index-ABC123.js:42:7",
  );
  assert.equal(normalizeFeedbackDiagnosticSource("C:\\Users\\name\\secret.txt", 3, 1), undefined);
});

test("오류 이력은 24시간 안의 최근 12건만 두고 같은 오류를 횟수로 합친다", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");
  const base = (index: number): FeedbackDiagnosticEvent => ({
    at: new Date(now - (20 - index) * 60_000).toISOString(),
    kind: "api",
    code: `error_${index}`,
    screen: "/parent/location",
    count: 1,
  });
  const many = Array.from({ length: FEEDBACK_DIAGNOSTIC_EVENT_LIMIT + 4 }, (_, index) => base(index));
  const appended = appendFeedbackDiagnosticEvent(many, base(20), now);
  assert.equal(appended.length, FEEDBACK_DIAGNOSTIC_EVENT_LIMIT);
  assert.equal(appended.at(-1)?.code, "error_20");

  const duplicate = appendFeedbackDiagnosticEvent(
    appended,
    { ...appended.at(-1), at: new Date(now).toISOString() } as FeedbackDiagnosticEvent,
    now,
  );
  assert.equal(duplicate.length, FEEDBACK_DIAGNOSTIC_EVENT_LIMIT);
  assert.equal(duplicate.at(-1)?.count, 2);

  const expired = appendFeedbackDiagnosticEvent(
    [{
      at: "2026-07-29T11:59:59.000Z",
      kind: "runtime",
      code: "TypeError",
      screen: "/child/home",
    }],
    base(20),
    now,
  );
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.code, "error_20");
});
