import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseTierAlertActivation,
  tierAlertActivationLabel,
} from "../src/transform/tierAlertActivation.ts";

test("서버가 확정한 알림 활성 상태만 사용자 상태로 채택한다", () => {
  assert.equal(parseTierAlertActivation({
    tier_alert_active: true,
    tier_alert_inactive_reason: null,
  }), "active");
  assert.equal(parseTierAlertActivation({
    tier_alert_active: false,
    tier_alert_inactive_reason: "premium_required",
  }), "premium_required");
  assert.equal(parseTierAlertActivation({}), "unknown");
  assert.equal(parseTierAlertActivation({
    tier_alert_active: false,
    tier_alert_inactive_reason: null,
  }), "unknown");
});

test("한도 초과 항목은 삭제된 것처럼 보이지 않고 Premium 알림 상태를 정확히 안내한다", () => {
  assert.equal(tierAlertActivationLabel("active"), "플랜 한도 안 · 알림 설정 가능");
  assert.equal(tierAlertActivationLabel("premium_required"), "저장됨 · 프리미엄에서 알림 대상");
  assert.equal(tierAlertActivationLabel("unknown"), "플랜 알림 대상 확인 필요");

  const manager = readFileSync(
    new URL("../src/screens/feature/PlaceManager.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../src/screens/feature/PlaceManager.css", import.meta.url),
    "utf8",
  );
  assert.match(manager, /parseTierAlertActivation\(p\)/);
  assert.match(manager, /parseTierAlertActivation\(z\)/);
  assert.match(manager, /tierAlertActivationLabel/);
  assert.match(styles, /\.pm-alert-state\[data-state="active"\][^{]*\{[^}]*var\(--mint-text\)/s);
  assert.match(styles, /\.pm-alert-state\[data-state="premium_required"\][^{]*\{[^}]*var\(--lav-text\)/s);
  assert.doesNotMatch(styles, /#39725b|#76558f/i);
});
