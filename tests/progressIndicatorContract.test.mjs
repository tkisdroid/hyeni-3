/**
 * 진행 표시자 계약 (2026-07-30 지시)
 *
 *   · 약 1초 이상 걸릴 수 있는 작업에는 진행 표시자를 둔다.
 *   · 진행률을 모르는 작업은 loop(무한 회전) 표시자를 쓴다.
 *   · Percent-done 표시자는 10초 이상 걸리는 작업에만 쓴다.
 *   · 정적 표시자는 쓰지 않는다 — 문구만 "저장 중…"으로 바꾸는 처리는 금지.
 *
 * 이 파일은 "정적으로 확실히 검증되는 부분"만 고정한다.
 * 화면별 실제 표시 여부는 느린 네트워크 재현 스윕(3초 지연)으로 확인한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const COMPONENTS_CSS = readFileSync("src/styles/components.css", "utf8");
const TSX = execSync("git ls-files src", { encoding: "utf8" })
  .split(/\r?\n/).filter((f) => f.endsWith(".tsx"));

/** 진행 상태를 뜻하는 식별자. disabled 식에 이게 있으면 '작업 중'이 표현돼야 한다. */
const PENDING = /(isPending|isFetching|isLoading|\bbusy\b|\bsaving\b|\bsending\b|\bstarting\b|\bringing\b|\bretrying\b|\bsubmitting\b|\buploading\b|\bdeleting\b|\bworking\b|\brefreshing\b|\blocating\b)/i;

/** `<button` 위치에서 여는 태그가 끝나는 '>' 인덱스. 중괄호·인용을 인식한다
 *  (onClick={() => ...} 의 화살표 '>' 에서 끊기면 안 된다). */
function tagEnd(src, start) {
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

function buttonTags(src) {
  const tags = [];
  let cursor = 0;
  for (;;) {
    const at = src.indexOf("<button", cursor);
    if (at < 0) break;
    const end = tagEnd(src, at);
    if (end < 0) break;
    tags.push(src.slice(at, end + 1));
    cursor = end + 1;
  }
  return tags;
}

/** 여는 태그와 그 안쪽 내용을 함께 준다(자체 스피너 렌더 여부 확인용). */
function buttonBlocks(src) {
  const out = [];
  let cursor = 0;
  for (;;) {
    const at = src.indexOf("<button", cursor);
    if (at < 0) break;
    const open = tagEnd(src, at);
    if (open < 0) break;
    const close = src.indexOf("</button>", open);
    out.push({ tag: src.slice(at, open + 1), body: close < 0 ? "" : src.slice(open + 1, close) });
    cursor = open + 1;
  }
  return out;
}

test("공용 진행 표시자는 aria-busy 컨트롤에 무한 회전 링을 붙인다", () => {
  const block = COMPONENTS_CSS.slice(COMPONENTS_CSS.indexOf('button[aria-busy="true"]'));
  assert.ok(
    COMPONENTS_CSS.includes('button[aria-busy="true"]:not(.hy-busy-quiet)::before'),
    "aria-busy 컨트롤에 붙는 ::before 표시자 규칙이 있어야 한다",
  );
  assert.match(block, /animation:\s*hy-spin\s+[\d.]+s\s+linear\s+infinite/, "진행률을 모르므로 loop 표시자여야 한다");
  assert.match(block, /border-top-color:\s*currentColor/, "채움색과 무관하게 보이도록 currentColor 를 써야 한다");
  // 진행 중에는 눌림 축소를 멈춘다(이미 비활성인데 줄어들면 오해를 준다).
  assert.match(block, /--press:\s*1/);
  // reduced motion 에서도 링 자체는 남겨 진행 중임을 계속 알린다.
  assert.match(block, /prefers-reduced-motion[\s\S]*animation:\s*none/);
});

test("진행 중 비활성되는 버튼은 모두 aria-busy 를 켠다(정적 표시자 금지)", () => {
  const offenders = [];
  for (const file of TSX) {
    const src = readFileSync(file, "utf8");
    for (const tag of buttonTags(src)) {
      if (/aria-busy=/.test(tag)) continue;
      const at = tag.indexOf("disabled={");
      if (at < 0) continue;
      if (!PENDING.test(tag.slice(at))) continue;
      offenders.push(`${file}  ${tag.slice(at, at + 72).replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `진행 중 비활성만 하고 진행 표시자가 없는 버튼이 있다. aria-busy={<진행 식>} 을 추가해야 한다:\n${offenders.join("\n")}`,
  );
});

test("자기 스피너를 그리는 버튼은 hy-busy-quiet 로 공용 링과 겹치지 않는다", () => {
  // 이 네 곳은 이미 RefreshCw / 자체 링을 돌린다 — 표시자가 두 개 보이면 안 된다.
  const owners = [
    ["src/components/ui/ScreenQueryState.tsx", "sqs-retry"],
    ["src/screens/child/ChildLocationStatus.tsx", "cls-cta"],
    ["src/screens/feature/LocationStatus.tsx", "ls-retry"],
    ["src/screens/feature/AiSchedule.tsx", "ais-mic"],
  ];
  for (const [file, cls] of owners) {
    const src = readFileSync(file, "utf8");
    const tags = buttonTags(src).filter((t) => t.includes(cls) && /aria-busy=/.test(t));
    assert.ok(tags.length > 0, `${file} 의 ${cls} 버튼에 aria-busy 가 있어야 한다`);
    for (const tag of tags) {
      assert.ok(
        tag.includes("hy-busy-quiet"),
        `${file} 의 ${cls} 는 자체 스피너가 있으므로 hy-busy-quiet 가 필요하다`,
      );
    }
  }
});

test("표시자는 한 버튼에 하나만 — 자체 스피너를 그리면 공용 링을 끈다", () => {
  // aria-busy 가 붙은 버튼이 안쪽에 자기 스피너까지 그리면 회전체가 두 개 보인다.
  const SPINNER = /(spin|Spin)\b|__ring|animate-spin/;
  const offenders = [];
  for (const file of TSX) {
    const src = readFileSync(file, "utf8");
    for (const { tag, body } of buttonBlocks(src)) {
      if (!/aria-busy=/.test(tag)) continue;
      if (tag.includes("hy-busy-quiet")) continue;
      if (!SPINNER.test(body) && !SPINNER.test(tag)) continue;
      const cls = (tag.match(/className=\{?"?([^"}\n]+)/) || [, "?"])[1];
      offenders.push(`${file}  ${cls.slice(0, 48)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `자체 스피너가 있는 aria-busy 버튼에는 hy-busy-quiet 가 필요하다(표시자 중복):\n${offenders.join("\n")}`,
  );
});

test("활성 아이 컨텍스트는 가족 조회 중임을 알려 '아이 없음' 단정을 막는다", () => {
  const provider = readFileSync("src/app/activeChild.tsx", "utf8");
  assert.match(provider, /familyLoading:\s*boolean/, "컨텍스트 타입에 familyLoading 이 있어야 한다");
  assert.match(provider, /isLoading:\s*familyLoading/, "useMyFamily 의 로딩 상태를 그대로 전달해야 한다");

  // 조회 중에는 빈 상태를 단정하지 않고 진행 표시자를 띄운다.
  const weekly = readFileSync("src/screens/feature/WeeklyFamilyReport.tsx", "utf8");
  assert.match(weekly, /!activeChild && familyLoading \?/);
  const day = readFileSync("src/screens/feature/DaySummary.tsx", "utf8");
  assert.match(day, /!childUserId && familyLoading \?/);
  const credit = readFileSync("src/screens/feature/AiCredit.tsx", "utf8");
  assert.match(credit, /if \(!childUserId && familyLoading\)/);
  const route = readFileSync("src/screens/feature/RouteView.tsx", "utf8");
  assert.match(route, /familyLoading \? "loading" : "no-child"/);
});

test("공용 소형 표시자는 애니메이션이 있고 보조기술에 상태를 알린다", () => {
  const loading = readFileSync("src/components/ui/Loading.tsx", "utf8");
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
  const css = readFileSync("src/components/ui/Loading.css", "utf8");
  assert.match(css, /animation:\s*hy-loading-pulse\s+[\d.]+s[^;]*infinite/);
});
