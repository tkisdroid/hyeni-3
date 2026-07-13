import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/app/NativeBootstrap.tsx", import.meta.url),
  "utf8",
);

test("Android 포그라운드는 세션 조정 뒤 활성 query만 취소·재조회한다", () => {
  const start = source.indexOf("// Android WebView 포그라운드 조회 복구");
  const end = source.indexOf("// 인증 확정", start);
  assert.ok(start >= 0 && end > start, "포그라운드 조회 복구 effect를 찾지 못했습니다");
  const block = source.slice(start, end);

  assert.match(block, /if \(!isNativePlatform\(\)\) return;/);
  assert.match(block, /App\.getState\(\)/);
  assert.match(block, /App\.addListener\("appStateChange"/);
  assert.match(block, /createNativeQueryResumeCoordinator/);
  assert.match(block, /resumeActiveQueriesAfterNativeForeground/);
  assert.match(block, /adoptSession: adoptNativeLocationSessionTokens/);
  assert.match(block, /syncSession: syncFromSession/);
  assert.match(
    block,
    /refetchQueries\(\s*\{ type: "active" \},\s*\{ cancelRefetch: true \}\s*\)/s,
  );
  assert.match(block, /coordinator\.dispose\(\)/);
  assert.match(block, /listener\?\.remove\(\)/);
  assert.doesNotMatch(
    block,
    /focusManager|resumePausedMutations|\.mutate\(|location\.reload|window\.location/,
  );
});
