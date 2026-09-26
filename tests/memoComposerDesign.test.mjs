import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(rootDir, "src/screens/shared/MemoChat.css"), "utf8");
const source = readFileSync(resolve(rootDir, "src/screens/shared/MemoChat.tsx"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))?.[1] ?? "";
}

test("대화 입력란의 사진·위치 도구는 투명한 아이콘만 표시한다", () => {
  const attach = rule(".mc-attach");
  const active = rule(".mc-attach:active");
  const icon = rule(".mc-attach > svg");
  const composer = source.slice(
    source.indexOf("{/* 하단 입력 (composer) */}"),
    source.indexOf("{previewImagePath && ("),
  );

  assert.equal((composer.match(/className="mc-attach hy-press"/g) ?? []).length, 2);
  assert.equal((composer.match(/aria-label=/g) ?? []).length, 4, "사진·위치·입력·전송에 이름이 있어야 한다");
  assert.match(composer, /<ImageIcon size=\{20\} strokeWidth=\{2\} aria-hidden="true" \/>/);
  assert.match(composer, /<MapPin size=\{20\} strokeWidth=\{2\} aria-hidden="true" \/>/);

  assert.match(attach, /width:\s*var\(--control-min-size\)/);
  assert.match(attach, /height:\s*var\(--control-min-size\)/);
  assert.match(attach, /border:\s*0/);
  assert.match(attach, /border-radius:\s*0/);
  assert.match(attach, /background:\s*transparent/);
  assert.match(attach, /box-shadow:\s*none/);
  assert.match(attach, /-webkit-backdrop-filter:\s*none/);
  assert.match(attach, /backdrop-filter:\s*none/);
  assert.match(active, /box-shadow:\s*none/);
  assert.doesNotMatch(`${attach}\n${active}`, /neu-|glass-|rgba?\(|#[0-9a-f]/i);
  assert.match(icon, /width:\s*var\(--icon-20\)/);
  assert.match(icon, /height:\s*var\(--icon-20\)/);
});

test("대화 컴포저는 하단 메뉴 위 전체 폭 레이아웃을 유지한다", () => {
  const root = rule(".mc-root");
  const composer = rule(".mc-composer");
  const end = rule(".mc-end");

  assert.match(root, /--mc-tabbar-clearance:\s*calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(composer, /position:\s*sticky/);
  assert.match(composer, /bottom:\s*var\(--mc-tabbar-clearance\)/);
  assert.match(composer, /padding:\s*8px 20px 12px/);
  assert.match(end, /height:\s*var\(--mc-bottom-clearance\)/);
});

test("대화 화면은 하단 메뉴·아이 독 없이 입력줄을 화면 바닥에 붙인다", () => {
  // 2026-09-26 TK 제보: 입력창 아래에 앱 하단 메뉴와 휴대폰 내비게이션이 겹겹이 쌓여 이상해 보였다.
  const shell = readFileSync(new URL("../src/app/AppShell.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/screens/shared/MemoChat.css", import.meta.url), "utf8");
  assert.match(shell, /const CHAT_PATHS = new Set\(\["\/parent\/memo", "\/child\/memo"\]\)/);
  assert.match(shell, /\{!chat && <TabBar tabs=\{tabs\} \/>\}/);
  assert.match(shell, /\{chat \? \(\s*<AiBuddyFabSlot bottomInset=\{20\} \/>\s*\) : \(\s*<>\s*<ChildDock \/>/);
  assert.match(css, /\.hy-app\[data-chat="true"\] \.mc-root\s*\{[^}]*--mc-tabbar-clearance:\s*env\(safe-area-inset-bottom, 0px\)/s);
});
