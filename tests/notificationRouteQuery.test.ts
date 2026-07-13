import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeNotificationRoute } from "../src/transform/notificationRoute.ts";

test("부모 알림은 허용된 다자녀 메모·정확한 SOS query만 보존한다", () => {
  assert.equal(
    sanitizeNotificationRoute("/parent/memo?child=child-123", "parent"),
    "/parent/memo?child=child-123",
  );
  assert.equal(
    sanitizeNotificationRoute("/sos-receive?alert=alert-1&child=child-1", "parent"),
    "/sos-receive?alert=alert-1&child=child-1",
  );
  assert.equal(
    sanitizeNotificationRoute("/notifications?alert=alert-2", "parent"),
    "/notifications?alert=alert-2",
  );
});

test("역할 외 경로·알 수 없는 query·외부 URL은 안전한 홈으로 강등한다", () => {
  assert.equal(sanitizeNotificationRoute("/child/memo", "parent"), "/parent/home");
  assert.equal(sanitizeNotificationRoute("/sos-receive?next=https://evil.test", "parent"), "/parent/home");
  assert.equal(sanitizeNotificationRoute("https://evil.test", "child"), "/child/home");
  assert.equal(sanitizeNotificationRoute("/parent/memo?child=a/b", "parent"), "/parent/home");
});
