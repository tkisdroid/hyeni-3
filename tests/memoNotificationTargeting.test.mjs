import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("부모 메모 화면은 유효하지 않은 명시적 child를 활성 아이로 대체하지 않는다", () => {
  const source = read("src/screens/shared/MemoChat.tsx");
  const koShared = JSON.parse(read("locales/ko/shared.json"));
  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\("child"\)/);
  assert.match(source, /m\.id === childHint \|\| m\.user_id === childHint/);
  assert.match(source, /if \(childHint\)[\s\S]{0,300}return hintedChild;/);
  assert.doesNotMatch(source, /return hintedChild \?\? activeChild/);
  assert.match(source, /explicitChildMissing/);
  assert.match(source, /shared\.memoChat\.copy016/);
  assert.equal(koShared["shared.memoChat.copy016"], "대화 대상 아이를 확인할 수 없어요");
});

test("부모 대화 탭 점은 parent_alert가 아니라 실제 아이별 memo read_by에서 계산한다", () => {
  const shell = read("src/app/AppShell.tsx");
  const query = read("src/queries/useMemo.ts");
  assert.doesNotMatch(shell, /useParentAlerts/);
  assert.match(shell, /useUnreadMemoForChildren/);
  assert.match(query, /useQueries/);
  assert.match(query, /r\.user_id !== userId/);
  assert.match(query, /!\(r\.read_by \?\? \[\]\)\.includes\(userId\)/);
});

test("아이 세션은 탭바 렌더 여부와 무관하게 다른 아이 스레드를 조회하지 않는다", () => {
  // 2026-09-22 R3CN400MGNW 실기기 E2E 실측: 아이 기기가 push 상세 화면(`#/supplies`·`#/route`)에
  // 들어가면 `/api/memos/replies?...child_id=<다른 아이>` 가 403 이었다. PushShell 이 탭바
  // **렌더**만 role 로 막고 useUnreadMemoForChildren 조회는 막지 않아 children[0] 스레드까지
  // 받아오려 했다. 조회 스코프(enabled)와 렌더 조건은 별개로 유지한다.
  const shell = read("src/app/AppShell.tsx");
  assert.match(shell, /function useMemoDotTabs\(baseTabs: TabItem\[\], memoPath: string, enabled: boolean\)/);
  assert.match(shell, /enabled[\s\S]{0,120}\?\s*\(family\?\.members \?\? \[\]\)[\s\S]{0,80}:\s*\[\]\)/);
  assert.match(shell, /useMemoDotTabs\(useParentTabs\(\), "\/parent\/memo", true\)/);
  assert.match(shell, /useMemoDotTabs\(useParentTabs\(\), "\/parent\/memo", role === "parent"\)/);
  assert.doesNotMatch(shell, /useMemoDotTabs\(useParentTabs\(\), "\/parent\/memo"\)/);
});

test("부모·아이 대화 표시는 최근 7일을 조회하고 자정·화면 복귀에 맞춰 갱신한다", () => {
  const shell = read("src/app/AppShell.tsx");
  const chat = read("src/screens/shared/MemoChat.tsx");
  const dock = read("src/app/ChildDock.tsx");
  const childHome = read("src/screens/child/ChildHome.tsx");
  assert.match(shell, /useRecentDateKeys\(7, familyTimeZone\)/);
  assert.match(chat, /useRecentDateKeys\(7, familyTimeZone\)/);
  assert.match(dock, /useRecentDateKeys\(7, familyTimeZone\)/);
  assert.match(dock, /useMemoThread\(dateKeys,/);
  assert.match(childHome, /const memoDateKeys = useRecentDateKeys\(7, familyTimeZone\)/);
  assert.match(childHome, /useMemoThread\(memoDateKeys,/);
  assert.doesNotMatch(dock, /todayDateKey\(new Date\(\)\), \[\]/);
  assert.doesNotMatch(childHome, /const now = useMemo\(\(\) => new Date\(\), \[\]\)/);
  assert.doesNotMatch(shell, /const today = todayDateKey\(\);[\s\S]{0,150}\}, \[\]\)/);
  assert.doesNotMatch(chat, /const today = todayDateKey\(\);[\s\S]{0,150}\}, \[\]\)/);

  const hook = read("src/app/useRecentDateKeys.ts");
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /millisecondsUntilNextDayInTimeZone/);
  assert.match(hook, /setTimeout/);
});

test("메모 전송은 조회한 KST 최근 범위의 마지막 date_key를 모든 전송 경로에 명시한다", () => {
  const query = read("src/queries/useMemo.ts");
  const chat = read("src/screens/shared/MemoChat.tsx");
  const childHome = read("src/screens/child/ChildHome.tsx");

  assert.match(query, /dateKey:\s*string/);
  assert.doesNotMatch(query, /dateKey\?:\s*string/);
  assert.doesNotMatch(query, /todayDateKey/);
  assert.match(query, /if \(!vars\.dateKey\) throw new Error/);
  assert.match(chat, /const memoDateKey = latestDateKeyOrNull\(dateKeys\)/);
  assert.equal(chat.match(/dateKey:\s*memoDateKey/g)?.length, 3);
  assert.match(childHome, /const memoDateKey = latestDateKeyOrNull\(memoDateKeys\)/);
  assert.match(childHome, /buildQuickStatusMemo\(actionId, myMember\.id, memoDateKey\)/);
});

test("아이 member id가 확정되지 않으면 메모 전체 스레드를 조회하거나 전송하지 않는다", () => {
  const query = read("src/queries/useMemo.ts");
  const chat = read("src/screens/shared/MemoChat.tsx");
  assert.match(query, /enabled:[\s\S]{0,160}!!childId/);
  assert.match(chat, /if \(!scopeChild\)[\s\S]{0,180}shared\.memoChat\.copy016/);
  assert.match(chat, /disabled=\{[^}]*!scopeChild/);
});

test("메모 읽음 저장은 일시 실패를 재시도하고 최종 실패 id를 다시 시도 가능하게 푼다", () => {
  const query = read("src/queries/useMemo.ts");
  const chat = read("src/screens/shared/MemoChat.tsx");
  assert.match(query, /useMarkRead[\s\S]*retry:\s*2/);
  assert.match(chat, /markReadRef\.current\s*\.\s*mutateAsync\(replyId\)/);
  assert.match(chat, /\.finally\(\(\) => markedRef\.current\.delete\(replyId\)\)/);
  assert.doesNotMatch(chat, /markReadRef\.current\.mutate\(r\.id,/);
});
