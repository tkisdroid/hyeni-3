import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const useSchedule = readFileSync("src/queries/useSchedule.ts", "utf8");
const eventForm = readFileSync("src/screens/parent/EventForm.tsx", "utf8");
const aiSchedule = readFileSync("src/screens/feature/AiSchedule.tsx", "utf8");

assert.ok(
  useSchedule.includes("useSaveEventsWithChildrenBatch"),
  "반복 일정 저장은 묶음 저장 훅을 통해 query invalidation 을 1회로 줄여야 한다",
);
assert.ok(
  useSchedule.includes("Promise.allSettled"),
  "묶음 저장은 전체 요청 완료를 기다린 뒤 실패를 보고해야 한다",
);
assert.ok(
  !eventForm.includes("await saveEvent.mutateAsync"),
  "EventForm 은 반복 일정 저장을 단건 mutateAsync 순차 루프로 처리하면 안 된다",
);
assert.ok(
  !aiSchedule.includes("for (const ev of parsed)"),
  "AiSchedule 은 여러 파싱 결과를 단건 mutateAsync 순차 루프로 처리하면 안 된다",
);
assert.ok(
  aiSchedule.includes("parsed.map"),
  "AiSchedule 은 여러 파싱 결과를 묶음 저장 입력으로 만들어야 한다",
);
assert.ok(
  useSchedule.includes("void qc.invalidateQueries({ queryKey: qk.events"),
  "일정 변경 후 refetch 는 백그라운드로 돌려 저장 버튼 pending 을 refetch 시간에 묶지 않아야 한다",
);

console.log("scheduleMutationPerf contract ok");
