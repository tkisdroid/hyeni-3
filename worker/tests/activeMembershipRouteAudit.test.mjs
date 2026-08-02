import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("로그인 제공자 역할 판정은 해제된 자녀 연결을 되살리지 않는다", async () => {
  for (const path of [
    "routes/auth.ts",
    "routes/family.ts",
    "routes/oauth.ts",
    "routes/naver-auth.ts",
    "routes/oauth-bridge.ts",
  ]) {
    const text = await source(path);
    assert.match(
      text,
      /SELECT role FROM family_members WHERE user_id=\? AND is_active=1 AND role IN \('parent','child'\) LIMIT 1/,
      path,
    );
  }
});

test("일정 준비물·위치 설정·스토어 혜택·스티커는 활성 가족만 권한으로 사용한다", async () => {
  const [supplies, prefs, rewards, stickers] = await Promise.all([
    source("routes/daily-supplies.ts"),
    source("routes/location-prefs.ts"),
    source("routes/review-rewards.ts"),
    source("routes/stickers.ts"),
  ]);
  assert.match(supplies, /role='child' AND is_active=1 LIMIT 1/);
  assert.match(supplies, /user_id=\? AND is_active=1 AND role IN \('parent','child'\) LIMIT 1/);
  assert.match(prefs, /resolveVerifiedFamilyMembership/);
  assert.match(rewards, /resolveVerifiedFamilyMembership/);
  assert.match(stickers, /resolveVerifiedFamilyMembership/);
  assert.match(stickers, /user_id = \? AND is_active = 1 LIMIT 1/);
});

test("친구놀이·결제·AI·네이티브 RPC는 비활성 child/parent를 작업 주체로 인정하지 않는다", async () => {
  const [playdate, billing, proactive, rpc] = await Promise.all([
    source("routes/playdate.ts"),
    source("routes/google-play-verify.ts"),
    source("routes/ai-proactive.ts"),
    source("routes/rest-shim-rpc.ts"),
  ]);
  assert.match(playdate, /resolveVerifiedFamilyMembership/);
  assert.match(playdate, /role = 'child' AND is_active = 1 LIMIT 1/);
  assert.match(billing, /resolveVerifiedFamilyMembership/);
  assert.match(billing, /role='child' AND is_active=1 LIMIT 1/);
  assert.match(proactive, /family_id=\? AND user_id=\? AND is_active=1 LIMIT 1/);
  assert.equal((rpc.match(/role = 'child' AND is_active = 1 LIMIT 1/g) ?? []).length >= 2, true);
});
