import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("아이 셸은 선택한 강조색을 아이 역할 환경에만 연결한다", () => {
  const shell = readSource("src/app/AppShell.tsx");
  const childShell = shell.slice(
    shell.indexOf("export function ChildShell"),
    shell.indexOf("export function TeacherShell"),
  );

  assert.match(childShell, /className="hy-app"\s+data-role="child"\s+data-accent=\{accent\}/);
  assert.match(
    readSource("src/styles/global.css"),
    /\.hy-app\[data-role="child"\]\s*\{[^}]*var\(--hy-accent-soft\)/s,
  );
});

test("아이 홈과 하단 독은 선택 색상을 넓은 면·경계·활성 상태에 함께 반영한다", () => {
  const home = readSource("src/screens/child/ChildHome.css");
  const dock = readSource("src/app/ChildDock.css");

  assert.match(home, /\.kd-root\s*\{[\s\S]*?--kd-card-line:[^;]*var\(--hy-accent\)/);
  assert.match(home, /\.kd-root\s*\{[\s\S]*?background:[^;]*var\(--hy-accent-soft\)/);
  assert.match(home, /\.kd-map\s*\{[\s\S]*?background:[\s\S]*?var\(--hy-accent-light\)/);
  assert.match(home, /\.kd-card\s*\{[\s\S]*?background:[\s\S]*?var\(--hy-accent-soft\)/);
  assert.match(home, /\.kd-tile\s*\{[\s\S]*?background:[\s\S]*?var\(--hy-accent-soft\)/);

  assert.match(dock, /\.kdock\s*\{[\s\S]*?background:[\s\S]*?var\(--hy-accent-soft\)/);
  assert.match(dock, /\.kdock__bar\s*\{[\s\S]*?var\(--hy-accent-soft\)/);
  assert.match(dock, /\.kdock__tab\[aria-current="page"\]\s*\{[^}]*var\(--hy-accent-soft\)/s);
});

test("AI 친구 설정·대화는 고정 보라색 대신 아이 선택 색상을 사용한다", () => {
  const chat = readSource("src/screens/child/AiFriendChat.css");
  const setup = readSource("src/screens/child/AiFriendSetup.css");

  for (const selector of [".afc", ".afc-head-name", ".afc-bubble--me", ".afc-typing span", ".afc-send"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(chat, new RegExp(`${escaped}\\s*\\{[\\s\\S]*?var\\(--(?:hy-accent|cta-grad-accent)`, "s"));
  }
  assert.doesNotMatch(chat, /#f3eeff|\.afc-(?:bubble--me|send)\s*\{[^}]*--cta-grad-lavender/s);

  for (const selector of [".afs", ".afs-cell--on", ".afs-chip--on", ".afs-cta"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(setup, new RegExp(`${escaped}\\s*\\{[\\s\\S]*?var\\(--(?:hy-accent|cta-grad-accent)`, "s"));
  }
  assert.doesNotMatch(setup, /#f1ecff|\.afs-cta\s*\{[^}]*--cta-grad-lavender/s);
});

test("기능 의미색은 개인화 색상과 섞지 않는다", () => {
  assert.match(
    readSource("src/screens/child/ChildSos.css"),
    /\.cs-root\s*\{[^}]*background:\s*var\(--cta-grad-danger\)/s,
  );
  assert.match(
    readSource("src/screens/child/ChildHome.css"),
    /\.kd-next__cta\s*\{[^}]*background:\s*var\(--cta-grad-mint\)/s,
  );
});
