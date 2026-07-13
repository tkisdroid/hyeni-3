import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/screens/feature/Notifications.tsx", import.meta.url), "utf8");

test("알림함은 push route의 alert 식별자를 해당 행 스크롤·강조에 사용한다", () => {
  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\("alert"\)/);
  assert.match(source, /alertItemRefs\.current\.get\(requestedAlertId\)/);
  assert.match(source, /nc-item--anchored/);
  assert.match(source, /data-alert-id=\{a\.id\}/);
});

test("SOS anchor가 목록에 없을 때 다른 최신 아이의 경보로 대체하지 않는다", () => {
  const sos = readFileSync(new URL("../src/screens/feature/SosReceive.tsx", import.meta.url), "utf8");
  assert.match(sos, /requestedAlertId\s*\?\s*list\.find\([\s\S]*?\) \?\? null\s*:\s*list\[0\]/);
  assert.match(sos, /선택한 긴급 알림을 찾지 못했어요/);
});
