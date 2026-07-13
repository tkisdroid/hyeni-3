import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/RemoteAudio.tsx"), "utf8");

test("원격청취 화면은 민감 기능 투명성 안내를 보여준다", () => {
  assert.match(source, /아이에게 알림이 가요/);
  assert.match(source, /아이 기기에서 알림을 누르고 직접 허용해야 시작돼요/);
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
