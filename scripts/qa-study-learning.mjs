/** 영단어·부모 풀이 조회를 production dist와 격리된 API fixture로 검증한다. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { mockApi, newDocumentScript } from "./final-browser-qa.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2] ? resolve(process.argv[2]) : resolve(tmpdir(), `hyeni-study-qa-${Date.now()}`);
const origin = "http://127.0.0.1:5197";
const catalog = JSON.parse(await readFile(resolve(root, "public/learning/vocabulary-catalog.json"), "utf8"));
const sample = catalog.words.filter(word => word.level === 1).slice(0, 3);
const reviews = new Map();
const reviewCalls = [];
const queries = [];
const failures = [];
const checks = [];
let failSavedResponse = true;
let failHistory = false;
const version = "2026-08-27";
const envelope = { apiVersion: version, catalogVersion: catalog.metadata.version, memberId: "qa-child-member" };
const levels = () => [1, 2, 3, 4, 5].map(level => {
  const latest = new Map([...reviews.values()].map(review => [review.wordId, review]));
  const items = [...latest.values()].filter(review => review.level === level);
  return { level, total: catalog.words.filter(word => word.level === level).length, studied: items.length,
    known: items.filter(review => review.rating === "known").length, again: items.filter(review => review.rating === "again").length };
});
const problem = { id: "qa-math-problem", prompt: "3 × 4는 얼마일까?", type: "integer", conceptTitle: "곱셈", domainLabel: "수와 연산",
  childObjective: "곱셈식을 계산할 수 있어", gradeTarget: 3, gradeBand: "3-4", domain: "number", conceptId: "multiplication",
  difficulty: 1, difficultyBand: "basic", standardCode: "4수01-05", input: { kind: "integer" } };
const mathItem = { id: "qa-attempt-a", missionId: "qa-mission", problemId: problem.id, studiedAt: "2026-09-12T01:00:00.000Z",
  detailsStatus: "available", problem, answer: { kind: "integer", value: "11" },
  explanation: { question: problem.prompt, concept: "같은 수를 여러 번 더한 값이야.", steps: ["4를 3번 더하면 12야."], answer: "12", commonMistake: "더한 횟수를 확인해 봐.", alternative: ["3을 4번 더해도 12야."] },
  isCorrect: false, skipped: false, isScored: true, hintLevel: 1, responseTimeSeconds: 18, attemptOrdinal: 1 };

await mkdir(output, { recursive: true });
const server = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "5197", "--strictPort"],
  { cwd: root, windowsHide: true, stdio: "ignore" });
let browser;
try {
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 서버 시작을 기다린다. */ }
    if (n === 99) throw new Error("브라우저 검증 서버 시작 실패");
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  async function open(role, route, width = 390, locale = "ko") {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale, serviceWorkers: "block", reducedMotion: "reduce" });
    await context.addInitScript({ content: newDocumentScript() });
    await context.addInitScript(({ locale }) => {
      localStorage.setItem("hy-active-child:qa-family", "qa-child-member");
      localStorage.setItem("hyeni-locale-v1", locale);
    }, { locale });
    const scenario = { role, tier: "free", country: "KR", studyState: "enabled" };
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const pathname = url.pathname;
      if (url.origin === origin && !pathname.startsWith("/api/") && !pathname.startsWith("/auth/")) return route.continue();
      if (!pathname.startsWith("/api/") && !pathname.startsWith("/auth/")) return route.fulfill({ status: 200, body: "" });
      let status = 200;
      let body;
      if (pathname.includes("/study/")) queries.push({ role, pathname, query: url.search });
      if (pathname === "/api/study/learner/vocabulary") {
        const level = url.searchParams.has("level") ? Number(url.searchParams.get("level")) : null;
        const mode = url.searchParams.get("mode") ?? "new";
        const latest = new Map([...reviews.values()].map(review => [review.wordId, review.rating]));
        const candidates = level === 1 ? sample.filter(word => mode === "all" || (mode === "review" ? latest.get(word.id) === "again" : !latest.has(word.id))) : [];
        const position = Number(url.searchParams.get("cursor") ?? "0");
        const cards = candidates.filter(word => sample.indexOf(word) >= position).slice(0, 2);
        const last = cards.at(-1);
        body = { ...envelope, levels: levels(), level, mode, cards: cards.map(word => ({ ...word, lastRating: latest.get(word.id) ?? null })),
          nextCursor: last && candidates.some(word => sample.indexOf(word) > sample.indexOf(last)) ? String(sample.indexOf(last) + 1) : null };
      } else if (pathname === "/api/study/learner/vocabulary/reviews") {
        const command = request.postDataJSON();
        const requestId = request.headers()["idempotency-key"];
        reviewCalls.push({ requestId, ...command });
        if (!reviews.has(requestId)) reviews.set(requestId, { apiVersion: version, memberId: envelope.memberId, requestId,
          wordId: command.wordId, level: command.level, rating: command.rating, reviewedAt: new Date().toISOString() });
        body = reviews.get(requestId);
        if (failSavedResponse) { failSavedResponse = false; status = 503; body = { error: "study_unavailable" }; }
      } else if (/\/study\/children\/[^/]+\/vocabulary$/u.test(pathname)) {
        const memberId = pathname.split("/").at(-2);
        const items = memberId === envelope.memberId ? [...reviews.values()].reverse() : [];
        const position = Number(url.searchParams.get("cursor") ?? "0");
        body = { ...envelope, memberId, levels: memberId === envelope.memberId ? levels() : levels().map(level => ({ ...level, studied: 0, known: 0, again: 0 })),
          lastStudiedAt: items[0]?.reviewedAt ?? null,
          reviews: items.slice(position, position + 2).map(review => ({ ...catalog.words.find(word => word.id === review.wordId), reviewId: review.requestId, rating: review.rating, reviewedAt: review.reviewedAt })),
          nextCursor: position + 2 < items.length ? String(position + 2) : null };
      } else if (/\/study\/children\/[^/]+\/history$/u.test(pathname)) {
        const memberId = pathname.split("/").at(-2);
        body = { apiVersion: version, memberId, range: url.searchParams.get("range") ?? "30d",
          items: memberId !== envelope.memberId ? [] : url.searchParams.has("cursor")
            ? [{ ...mathItem, id: "qa-attempt-b", detailsStatus: "details_unavailable", problem: null, explanation: null, answer: null, skipped: true }]
            : [mathItem], nextCursor: memberId === envelope.memberId && !url.searchParams.has("cursor") ? "next-math" : null };
        if (failHistory) { status = 503; body = { error: "study_unavailable" }; }
      } else {
        body = mockApi(pathname, scenario, request.method(), request.postData() ? request.postDataJSON() : null, request.headers());
        status = scenario.lastResponseCode ?? 200;
        if (pathname === "/api/family/mine" && body?.members) {
          const child = body.members.find(member => member.id === envelope.memberId);
          body.members.push({ ...child, id: "qa-sibling-member", user_id: "qa-sibling", name: "둘째" });
        }
        if (/\/study\/children\/[^/]+\/report$/u.test(pathname)) body = { ...body, memberId: pathname.split("/").at(-2), range: url.searchParams.get("range") ?? "30d" };
      }
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(`${origin}/?qaRole=${role}#/${route}`);
    return { context, page };
  }
  async function capture(page, name, target = ".vocabulary-screen") {
    const container = page.locator(target);
    await expect(container).toBeVisible();
    const geometry = await page.evaluate(selector => {
      const root = document.querySelector(selector);
      const small = [...root.querySelectorAll("button, a[href], summary")].filter(element => element.getClientRects().length > 0)
        .map(element => ({ text: element.textContent.trim().slice(0, 60), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
        .filter(rect => rect.width < 43.5 || rect.height < 43.5);
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, contentWidth: root.clientWidth, contentScrollWidth: root.scrollWidth, small };
    }, target);
    assert.ok(geometry.documentWidth <= geometry.width + 1, `${name}: 가로 넘침`);
    assert.ok(geometry.contentScrollWidth <= geometry.contentWidth + 1, `${name}: 화면 안쪽 가로 넘침`);
    assert.deepEqual(geometry.small, [], `${name}: 터치 영역`);
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
    checks.push({ name, geometry });
  }

  const child = await open("child", "miniapps");
  await child.page.getByRole("button", { name: /영단어 카드/u }).click();
  await expect(child.page.getByText("5단계 · 4,067단어", { exact: true })).toBeVisible();
  await expect(child.page.locator(".vocabulary-level")).toHaveCount(5);
  await expect(child.page.locator(".abf")).toHaveCount(0);
  await capture(child.page, "child-levels-390");
  await child.page.locator(".vocabulary-level").first().click();
  const card = child.page.locator(".vocabulary-card");
  await expect(card).toHaveAttribute("data-word-id", sample[0].id);
  await expect(child.page.getByRole("button", { name: "알겠어", exact: true })).toBeDisabled();
  await card.press("Enter");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await capture(child.page, "child-flipped-390");
  assert.ok(await child.page.locator(".vocabulary-card__inner").evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration) < 0.0001), "동작 줄이기 설정");
  await child.page.getByRole("button", { name: "알겠어", exact: true }).click();
  await expect(child.page.getByText("저장됐는지 확인하지 못했어. 같은 카드에서 다시 저장해 줘.", { exact: true })).toBeVisible();
  await expect(card).toHaveAttribute("data-word-id", sample[0].id);
  await child.page.getByRole("button", { name: "다시 저장하기", exact: true }).click();
  await expect(card).toHaveAttribute("data-word-id", sample[1].id);
  assert.equal(reviews.size, 1);
  assert.deepEqual(reviewCalls[0], reviewCalls[1]);
  for (const [word, rating] of [[sample[1], "다시 볼래"], [sample[2], "알겠어"]]) {
    await expect(card).toHaveAttribute("data-word-id", word.id);
    await card.click();
    await child.page.getByRole("button", { name: rating, exact: true }).click();
  }
  await expect(child.page.getByRole("heading", { name: "이번 단어를 다 확인했어!" })).toBeVisible();
  assert.equal(reviews.size, 3);
  await child.page.getByRole("button", { name: "단계 선택하기", exact: true }).last().click();
  await child.page.getByRole("button", { name: "복습", exact: true }).click();
  await child.page.locator(".vocabulary-level").first().click();
  await expect(card).toHaveAttribute("data-word-id", sample[1].id);
  checks.push({ name: "저장 실패 재시도 멱등성과 페이지 완주·복습", reviews: reviews.size, saves: reviewCalls.length });
  await child.context.close();

  const parent = await open("parent", "study/vocabulary");
  await expect(parent.page.locator(".vocabulary-review")).toHaveCount(2);
  await parent.page.getByRole("button", { name: "더 불러오기", exact: true }).click();
  await expect(parent.page.locator(".vocabulary-review")).toHaveCount(3);
  await capture(parent.page, "parent-vocabulary-390");
  await parent.page.evaluate(() => { location.hash = "#/study/vocabulary?member=qa-sibling-member"; });
  await expect(parent.page.getByText("아직 저장된 영단어 학습 기록이 없어요.", { exact: true })).toBeVisible();
  await expect(parent.page.locator(".vocabulary-review")).toHaveCount(0);
  await parent.page.evaluate(() => { location.hash = "#/study?member=qa-child-member"; });
  const attempt = parent.page.locator(".study-attempt").first();
  await expect(attempt).toBeVisible();
  await attempt.locator("summary").click();
  await expect(attempt.locator(".study-answer-comparison dd").first()).toHaveText("11");
  await expect(attempt.locator(".study-answer-comparison dd").last()).toHaveText("12");
  await expect(attempt.getByText("3을 4번 더해도 12야.", { exact: true })).toBeVisible();
  await parent.page.getByRole("button", { name: "더 불러오기", exact: true }).click();
  await expect(parent.page.locator(".study-attempt")).toHaveCount(2);
  await parent.page.locator(".study-attempt").last().locator("summary").click();
  await expect(parent.page.getByText("원문이나 답안·해설 일부를 확인할 수 없어요. 저장된 내용만 표시해요.", { exact: true })).toBeVisible();
  await capture(parent.page, "parent-math-390", ".study-history-section");
  await parent.page.evaluate(() => { location.hash = "#/study?member=qa-sibling-member"; });
  await expect(parent.page.getByText("선택한 기간에 저장된 풀이 기록이 없어요.", { exact: true })).toBeVisible();
  await expect(parent.page.locator(".study-attempt")).toHaveCount(0);
  checks.push({ name: "부모의 어휘·수학 원문 조회와 아이 전환", answer: "11", correct: "12", isolated: true });
  await parent.context.close();

  failHistory = true;
  const errorCase = await open("parent", "study");
  const section = errorCase.page.locator(".study-history-section");
  await expect(section.getByRole("alert")).toBeVisible({ timeout: 15000 });
  await expect(section.getByText("선택한 기간에 저장된 풀이 기록이 없어요.", { exact: true })).toHaveCount(0);
  failHistory = false;
  await section.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(section.locator(".study-attempt")).toHaveCount(1);
  checks.push({ name: "조회 오류를 빈 기록과 구분하고 재시도로 복구" });
  await errorCase.context.close();

  for (const width of [320, 1280]) {
    const mobile = await open("child", "study/vocabulary/learn", width);
    await expect(mobile.page.locator(".vocabulary-level")).toHaveCount(5);
    await mobile.page.locator(".vocabulary-sources summary").click();
    await capture(mobile.page, `child-levels-${width}`);
    await mobile.context.close();
  }
  const english = await open("child", "study/vocabulary/learn", 390, "en");
  await expect(english.page.locator(".vocabulary-level")).toHaveCount(5);
  await capture(english.page, "child-levels-en-390");
  assert.doesNotMatch(await english.page.locator(".vocabulary-screen").innerText(), /study\.vocabulary\./u);
  await english.context.close();
  for (const [role, path, destination] of [["child", "study/vocabulary", "child/home"], ["parent", "study/vocabulary/learn", "parent/home"]]) {
    const denied = await open(role, path);
    await expect(denied.page).toHaveURL(new RegExp(`#/${destination}$`, "u"));
    await expect(denied.page.locator(".vocabulary-screen")).toHaveCount(0);
    await denied.context.close();
    checks.push({ name: `${role} 세션의 반대 역할 영어 화면 차단` });
  }
  assert.deepEqual(failures, [], "브라우저 실행 오류");
  await writeFile(resolve(output, "report.json"), JSON.stringify({ status: "PASS", catalogCount: catalog.words.length, checks, queries, failures }, null, 2));
  process.stdout.write(JSON.stringify({ status: "PASS", checks: checks.length, output }) + "\n");
} catch (error) {
  if (browser) for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) await page.screenshot({ path: resolve(output, `failure-${index}-${pageIndex}.png`), fullPage: true }).catch(() => {});
  }
  await writeFile(resolve(output, "report.json"), JSON.stringify({ status: "FAIL", error: String(error), checks, queries, failures }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill();
}
