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
const PENDING = /(isPending|isFetching|isLoading|[A-Za-z]*(?:busy|pending|saving|sending|starting|ringing|retrying|submitting|uploading|deleting|working|refreshing|locating)[A-Za-z]*)/i;

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
      // 진행 표시는 실행 버튼이 소유하고, 취소·닫기·형제 설정만 잠기는 경우를 명시한다.
      if (/data-progress-owner=/.test(tag)) continue;
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
  const SPINNER = /(spin|Spin)\b|__ring|animate-spin|<BusyLabel\b/;
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

test("아이콘만 있는 원형 버튼은 진행 링을 가운데에 겹쳐 글리프가 밀리지 않는다", () => {
  // 2026-08-17 TK 제보: 채팅 보내기 버튼의 비행기가 전송 중 한쪽으로 치우쳐 보였다.
  // 원인은 공용 링(::before)이 flex 행에 끼어 아이콘을 밀어낸 것 — 링을 가운데로 겹친다.
  assert.ok(
    COMPONENTS_CSS.includes('button.hy-busy-center[aria-busy="true"]:not(.hy-busy-quiet)::before'),
    "아이콘 전용 컨트롤용 가운데 정렬 규칙이 있어야 한다",
  );
  const block = COMPONENTS_CSS.slice(
    COMPONENTS_CSS.indexOf('button.hy-busy-center[aria-busy="true"]'),
  );
  assert.match(block, /position:\s*absolute/, "링을 흐름에서 빼야 아이콘이 밀리지 않는다");
  assert.match(block, /translate:\s*-50% -50%/);
  assert.match(block, /margin-inline-end:\s*0/, "라벨용 여백을 남기면 다시 치우친다");
  assert.match(block, /visibility:\s*hidden/, "겹치는 동안 아이콘은 감춘다");

  const memo = readFileSync("src/screens/shared/MemoChat.tsx", "utf8");
  const send = buttonTags(memo).filter((tag) => tag.includes("mc-send"));
  assert.equal(send.length, 1, "보내기 버튼은 하나여야 한다");
  assert.match(send[0], /hy-busy-center/);
  assert.match(send[0], /aria-busy=\{sendMemo\.isPending\}/);

  // 펄스(투명도) 애니메이션을 되살리면 링과 겹쳐 표시자가 둘로 보인다.
  const sending = /\.mc-send--sending\s*\{([^}]*)\}/.exec(
    readFileSync("src/screens/shared/MemoChat.css", "utf8"),
  );
  assert.ok(sending, ".mc-send--sending 규칙이 있어야 한다");
  assert.doesNotMatch(sending[1], /animation:/);
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
  // 움직임은 이제 CSS keyframe 이 아니라 공용 로딩 마크(애니메이션 webp)가 갖는다.
  assert.match(loading, /<LoaderMark \/>/, "소형 표시자는 공용 로딩 마크를 써야 한다");
});

test("화면 로딩은 전부 공용 로딩 마크 하나를 쓴다", () => {
  // 화면마다 다른 로더를 만들면 같은 앱에서 서로 다른 그림이 돈다.
  const consumers = [
    ["src/components/ui/Loading.tsx", "calendar"],
    ["src/components/ui/RouteLoading.tsx", "calendar"],
    ["src/components/ui/ScreenQueryState.tsx", "calendar"],
    ["src/maps/providers/kakao/KakaoMapAdapter.tsx", "location"],
    ["src/screens/feature/RouteView.tsx", "location"],
  ];
  for (const [file, variant] of consumers) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /import \{ LoaderMark \}/, `${file} 가 공용 로딩 마크를 import 해야 한다`);
    const expected = variant === "location" ? /<LoaderMark variant="location" \/>/ : /<LoaderMark \/>/;
    assert.match(src, expected, `${file} 는 ${variant} 마크를 써야 한다`);
  }

  // 크기는 소비 화면 CSS 의 몫이다 — 공용 컴포넌트가 인라인 style 로 덮어쓰면 안 된다.
  const mark = readFileSync("src/components/ui/LoaderMark.tsx", "utf8");
  assert.doesNotMatch(mark, /style=\{/, "로딩 마크에 인라인 style 을 주면 소비 화면 배치를 덮어쓴다");
  assert.match(
    COMPONENTS_CSS,
    /\.hy-loader-mark\s*\{[^}]*width:\s*var\(--loader-mark-size,\s*\d+px\)/s,
    "크기는 --loader-mark-size 로 정한다",
  );
});

test("로딩 마크는 진짜 loop 표시자이고 움직임 줄이기에서는 정지 프레임으로 바뀐다", () => {
  // 애니메이션 webp 는 CSS 로 멈출 수 없으므로 <picture> 가 정지본을 대신 내려준다.
  const mark = readFileSync("src/components/ui/LoaderMark.tsx", "utf8");
  assert.match(mark, /media="\(prefers-reduced-motion: reduce\)"/);
  assert.match(mark, /srcSet=\{asset\(`ui\/loader-\$\{variant\}-still\.webp`\)\}/);
  assert.match(mark, /src=\{asset\(`ui\/loader-\$\{variant\}\.webp`\)\}/);

  // 파일이 실제로 움직이는지/멈춰 있는지는 webp 의 ANIM 청크로만 확인할 수 있다.
  for (const variant of ["calendar", "location"]) {
    const animated = readFileSync(`public/assets/ui/loader-${variant}.webp`);
    const still = readFileSync(`public/assets/ui/loader-${variant}-still.webp`);
    assert.notEqual(animated.indexOf("ANIM"), -1, `loader-${variant} 은 애니메이션이어야 한다(정적 표시자 금지)`);
    assert.equal(still.indexOf("ANIM"), -1, `loader-${variant}-still 은 정지 프레임이어야 한다`);
  }
});
