import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/screens/parent/ChildDetail.tsx", import.meta.url),
  "utf8",
);

test("아이 연결 해제 확인창은 영구 삭제되는 대화·공유 사진·위치·연결을 모두 고지한다", () => {
  assert.match(source, /대화·공유 사진·위치 기록·연결을 모두 지워요/);
  assert.match(source, /대화와 공유 사진, 위치 기록과 연결이 모두 영구 삭제/);
  assert.match(source, /되돌릴 수 없어요/);
});
