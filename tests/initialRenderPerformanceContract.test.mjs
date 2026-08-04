import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(resolve(rootDir, path), "utf8");

test("참조하지 않는 2MB 기본 웹폰트는 웹·Android 패키지 입력에 남기지 않는다", () => {
  assert.doesNotMatch(source("src/styles/global.css"), /PretendardVariable\.woff2/);
  assert.doesNotMatch(source("src/main.tsx"), /styles\/jua\.css/);
  assert.equal(existsSync(resolve(rootDir, "public/fonts/PretendardVariable.woff2")), false);
  assert.doesNotMatch(source("vite.config.ts"), /PretendardVariable\.woff2/);
  assert.match(source("index.html"), /class="boot-shell" role="status" aria-live="polite"/);
  assert.match(source("index.html"), /혜니캘린더를 여는 중/);
  assert.match(
    source("index.html"),
    /rel="preload" as="image" href="\/assets\/mascot\/wave\.webp" type="image\/webp" fetchpriority="high"/,
  );
  assert.doesNotMatch(source("index.html"), /rel="preload" as="font"[^>]*\/fonts\/jua\//);
  assert.doesNotMatch(source("index.html"), /boot-shell[^\n]+<img/);
});

test("콜드스타트 브랜드 스플래시는 1초 안에 완전히 사라진다", () => {
  const app = source("src/app/App.tsx");
  const showMs = Number(app.match(/const SPLASH_SHOW_MS = (\d+);/)?.[1]);
  const fadeMs = Number(app.match(/const SPLASH_FADE_MS = (\d+);/)?.[1]);

  assert.ok(Number.isFinite(showMs), "스플래시 표시 시간을 읽을 수 있어야 한다");
  assert.ok(Number.isFinite(fadeMs), "스플래시 페이드 시간을 읽을 수 있어야 한다");
  assert.ok(showMs + fadeMs <= 1000, `스플래시 총 고정 대기가 ${showMs + fadeMs}ms이다`);
});

test("Jua는 실제 사용하는 지연 로드 화면과 함께 로드한다", () => {
  for (const path of [
    "src/screens/child/ChildHome.tsx",
    "src/screens/child/StickerBook.tsx",
    "src/screens/child/ChildSos.tsx",
    "src/screens/child/AiFriendChat.tsx",
    "src/screens/shared/MemoChat.tsx",
  ]) {
    assert.match(source(path), /import "@\/styles\/jua\.css";/, `${path}: Jua route import 누락`);
  }
});
