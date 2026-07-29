import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/RemoteAudio.tsx"), "utf8");

test("원격청취 화면은 민감 기능 투명성 안내를 보여준다", () => {
  assert.match(source, /아이에게 알림이 가요/);
  // 위급 청취는 아이 동의 탭을 받지 않는다. 대신 숨기지 않는다는 사실을 부모에게 정확히 알린다.
  assert.match(source, /아이가 누르지 않아도 연결되고, 듣는 동안 아이 화면에 계속 표시돼요/);
  assert.doesNotMatch(source, /직접 허용해야 시작돼요/);
  assert.match(source, /1분 후 자동 종료돼요/);
  assert.match(source, /기록이 남아요/);
  assert.match(source, /위급할 때만 사용해 주세요/);
});

test("원격청취 실패 문구는 부모가 다음 행동을 알 수 있게 구체적이다", () => {
  assert.match(source, /아이 기기가 오프라인이거나 알림을 받을 수 없어요/);
  assert.match(source, /주변 소리 듣기는 프리미엄에서 사용할 수 있어요/);
  assert.match(source, /SOS와 긴급 알림은 무료로 계속 받을 수 있어요/);
  assert.match(source, /아이 앱이 설치되어 있고 로그인되어 있는지 확인해 주세요/);
});
