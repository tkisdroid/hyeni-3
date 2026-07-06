import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tsx = readFileSync("src/screens/shared/MemoChat.tsx", "utf8");
const css = readFileSync("src/screens/shared/MemoChat.css", "utf8");

const threadStart = tsx.indexOf('<div className="mc-thread">');
const composerStart = tsx.indexOf('<div className="mc-composer">');
const endRef = tsx.indexOf('ref={endRef}');

assert.ok(threadStart >= 0, "mc-thread 영역이 있어야 합니다");
assert.ok(composerStart > threadStart, "composer는 thread 뒤에 있어야 합니다");
assert.ok(endRef > threadStart && endRef < composerStart, "스크롤 기준점은 입력창 앞의 메시지 영역 안에 있어야 합니다");

assert.match(css, /--mc-bottom-clearance:\s*calc\(/, "메시지 하단 여백 변수는 입력창+탭바 높이를 포함해야 합니다");
assert.match(css, /\.mc-end\s*\{[\s\S]*height:\s*var\(--mc-bottom-clearance\)/, "스크롤 기준점은 하단 가림 방지 높이를 가져야 합니다");
assert.match(css, /\.mc-end\s*\{[\s\S]*flex:\s*none/, "스크롤 기준점 높이는 flex 수축으로 사라지면 안 됩니다");
assert.ok(
  tsx.includes('.closest(".hy-screen")') || tsx.includes(".closest('.hy-screen')"),
  "자동 스크롤은 앱 내부 스크롤 컨테이너를 직접 찾아야 합니다",
);
assert.match(tsx, /\.scrollTo\(\{[\s\S]*top:\s*scrollHost\.scrollHeight/, "자동 스크롤은 hy-screen의 실제 scrollHeight까지 이동해야 합니다");

console.log("memoChat layout contract ok");
