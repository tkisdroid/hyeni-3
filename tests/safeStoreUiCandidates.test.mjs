import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  assessCandidateReadiness,
  SAFE_STORE_UI_CANDIDATES,
  SAFE_STORE_UI_CANDIDATE_DIR,
  STORE_UI_HEIGHT,
  STORE_UI_WIDTH,
  waitForCandidateReadiness,
} from "../scripts/create-safe-store-ui-candidates.mjs";
import { hashDirectory, hashFile } from "../scripts/release-evidence.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function hashManifestWithLf(text) {
  return createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

test("실제 UI 후보 생성기는 production dist·정적 데모 세션만 사용하고 외부 요청을 통과시키지 않는다", async () => {
  const source = await readFile(resolve(ROOT_DIR, "scripts/create-safe-store-ui-candidates.mjs"), "utf8");
  assert.match(source, /dist\/index\.html/);
  assert.match(source, /local-production-dist-with-static-demo-session/);
  assert.match(source, /Fetch\.fulfillRequest/);
  assert.match(source, /Fetch\.enable", \{ patterns: \[\{ urlPattern: "https:\/\/\*" \}\] \}/);
  assert.match(source, /Emulation\.setTimezoneOverride/);
  assert.match(source, /Asia\/Seoul/);
  assert.match(source, /prepareCandidateCapture/);
  assert.match(source, /waitForDocumentReadiness/);
  assert.match(source, /document\.readyState/);
  assert.match(source, /index\.html\?capture=/);
  assert.match(source, /DevToolsActivePort/);
  assert.match(source, /remote-debugging-port=0/);
  assert.match(source, /await stopProcessTree\(chrome\)/);
  assert.match(source, /document\.fonts\.ready/);
  assert.match(source, /document\.fonts\.status === "loaded"/);
  assert.match(source, /resolveFontWait\(false\), 500/);
  assert.match(source, /sourceDistBefore/);
  assert.match(source, /production_dist_changed_during_capture/);
  assert.match(source, /technical-review\.json/);
  assert.match(source, /quick_reply_chip_clipped/);
  assert.match(source, /scrollTarget\.scrollBy\(0,/);
  assert.doesNotMatch(source, /output[\\/]store-screenshots|tmp-verify-ui|\badb\b/);
  assert.doesNotMatch(source, /(?:01[016789]|02|0[3-6][1-5])-?\d{3,4}-?\d{4}/);
  assert.doesNotMatch(source, /4,900|39,000|무료 체험|추천 플랜/);
  assert.match(source, /\|KID-\|QR\|초대 코드\|/);
  assert.match(source, /\\d\{1,2\}\\\.\\d\{4,\}\\s\*\[,\/\]\\s\*\[\+-\]\?\\d\{1,3\}/);
});

test("실제 UI 후보는 가격 화면 없이 인앱 라우트 6개로 구성된다", () => {
  assert.equal(SAFE_STORE_UI_CANDIDATES.length, 6);
  assert.ok(SAFE_STORE_UI_CANDIDATES.length >= 4 && SAFE_STORE_UI_CANDIDATES.length <= 8);
  const routes = SAFE_STORE_UI_CANDIDATES.map((candidate) => candidate.route);
  assert.deepEqual(routes, [
    "parent/home",
    "parent/calendar",
    "parent/memo",
    "daily-report",
    "weekly-report",
    "child/home",
  ]);
  assert.equal(routes.includes("subscription"), false);
  assert.equal(SAFE_STORE_UI_CANDIDATES.some((candidate) => /price|promo|subscription/i.test(candidate.file)), false);
  for (const candidate of SAFE_STORE_UI_CANDIDATES) {
    assert.equal(typeof candidate.semanticSelector, "string", `${candidate.route} semanticSelector`);
    assert.ok(candidate.semanticSelector.trim().length > 0, `${candidate.route} semanticSelector`);
    assert.ok(Array.isArray(candidate.expectedTexts), `${candidate.route} expectedTexts`);
    assert.ok(candidate.expectedTexts.length >= 2, `${candidate.route} expectedTexts`);
    assert.ok(candidate.expectedTexts.every((text) => typeof text === "string" && text.trim().length > 0));
  }
});

test("후보 준비 판정은 고유 의미 요소와 기대 문구가 모두 있고 스플래시·로딩이 끝나야 통과한다", () => {
  const candidate = {
    route: "child/home",
    semanticSelector: ".kd-root .kd-node",
    expectedTexts: ["데모 자녀의 오늘", "가족 일정"],
  };
  const readyState = {
    hash: "#/child/home",
    text: "데모 자녀의 오늘 가족 일정",
    crash: false,
    width: 360,
    semanticSelectorFound: true,
    bootSplashPresent: false,
    visibleLoadingTexts: [],
    fontsLoaded: true,
  };

  assert.deepEqual(assessCandidateReadiness(candidate, readyState), {
    ready: true,
    problems: [],
  });
  assert.equal(assessCandidateReadiness(candidate, { ...readyState, bootSplashPresent: true }).ready, false);
  assert.equal(assessCandidateReadiness(candidate, {
    ...readyState,
    visibleLoadingTexts: ["가족 일정을 불러오는 중"],
  }).ready, false);
  assert.equal(assessCandidateReadiness(candidate, {
    ...readyState,
    semanticSelectorFound: false,
  }).ready, false);
  assert.equal(assessCandidateReadiness(candidate, {
    ...readyState,
    text: "데모 자녀의 오늘",
  }).ready, false);
  assert.equal(assessCandidateReadiness(candidate, {
    ...readyState,
    fontsLoaded: false,
  }).ready, false);
});

test("후보 준비 대기는 제한 시간 안에 의미 화면이 나타나지 않으면 생성을 중단한다", async () => {
  const candidate = SAFE_STORE_UI_CANDIDATES.at(-1);
  let evaluationCount = 0;
  const cdp = {
    async evaluate() {
      evaluationCount += 1;
      return {
        hash: "#/child/home",
        text: "가족 일정을 불러오는 중",
        crash: false,
        width: 360,
        semanticSelectorFound: false,
        bootSplashPresent: true,
        visibleLoadingTexts: ["가족 일정을 불러오는 중"],
        fontsLoaded: true,
      };
    },
  };

  await assert.rejects(
    waitForCandidateReadiness(cdp, candidate, { timeoutMs: 8, pollIntervalMs: 1 }),
    /실제 UI 후보 준비 시간 초과: child\/home .*boot_splash_present/,
  );
  assert.ok(evaluationCount >= 1);
  assert.ok(evaluationCount <= 20, `bounded wait 평가 횟수: ${evaluationCount}`);
});

test("후보 준비 대기는 라우트 전환 중 일시적인 브라우저 평가 실패를 재시도한다", async () => {
  const candidate = SAFE_STORE_UI_CANDIDATES.at(-1);
  let evaluationCount = 0;
  const cdp = {
    async evaluate() {
      evaluationCount += 1;
      if (evaluationCount === 1) throw new Error("execution context was destroyed");
      return {
        hash: "#/child/home",
        text: "데모 자녀의 오늘 가족 일정",
        crash: false,
        width: 360,
        semanticSelectorFound: true,
        bootSplashPresent: false,
        visibleLoadingTexts: [],
        fontsLoaded: true,
      };
    },
  };

  const state = await waitForCandidateReadiness(cdp, candidate, { timeoutMs: 50, pollIntervalMs: 1 });
  assert.equal(state.hash, "#/child/home");
  assert.equal(evaluationCount, 2);
});

test("360px 메모 화면에서는 빠른 답장 칩을 줄바꿈해 잘린 칩을 만들지 않는다", async () => {
  const css = await readFile(resolve(ROOT_DIR, "src/screens/shared/MemoChat.css"), "utf8");
  assert.match(
    css,
    /@media\s*\(max-width:\s*380px\)[\s\S]*?\.mc-quick\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow-x:\s*visible;/,
  );
  assert.match(css, /\.mc-header\s*\{[^}]*background:\s*#fbf7f4;/);
  assert.doesNotMatch(css, /\.mc-header\s*\{[^}]*background:\s*rgba\(/);
});

test("실제 UI 후보 PNG 6장은 1080×1920 불투명 RGB이며 개인정보 메타데이터가 없다", async () => {
  const names = await readdir(SAFE_STORE_UI_CANDIDATE_DIR);
  const pngNames = names.filter((name) => extname(name).toLowerCase() === ".png").sort();
  assert.deepEqual(pngNames, SAFE_STORE_UI_CANDIDATES.map((candidate) => candidate.file).sort());

  for (const name of pngNames) {
    const file = resolve(SAFE_STORE_UI_CANDIDATE_DIR, name);
    const [metadata, stats] = await Promise.all([sharp(file).metadata(), sharp(file).stats()]);
    assert.equal(metadata.format, "png", `${name} format`);
    assert.equal(metadata.width, STORE_UI_WIDTH, `${name} width`);
    assert.equal(metadata.height, STORE_UI_HEIGHT, `${name} height`);
    assert.equal(metadata.channels, 3, `${name} RGB channels`);
    assert.equal(metadata.hasAlpha, false, `${name} alpha`);
    assert.equal(metadata.exif, undefined, `${name} EXIF`);
    assert.equal(metadata.iptc, undefined, `${name} IPTC`);
    assert.equal(metadata.xmp, undefined, `${name} XMP`);
    assert.ok(stats.channels.every((channel) => channel.stdev > 8), `${name}가 비어 있음`);
  }
});

test("실제 UI 후보 manifest는 자동 업로드가 아닌 정책·육안 검토 대기 상태다", async () => {
  const manifestPath = resolve(SAFE_STORE_UI_CANDIDATE_DIR, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.source, "local-production-dist-with-static-demo-session");
  assert.equal(typeof manifest.sourceDist?.fileCount, "number");
  assert.ok(manifest.sourceDist.fileCount > 0);
  assert.match(manifest.sourceDist.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.uploadStatus, "candidate_requires_policy_and_visual_review");
  assert.deepEqual(manifest.files, SAFE_STORE_UI_CANDIDATES);
  assert.deepEqual(
    manifest.artifacts,
    await Promise.all(SAFE_STORE_UI_CANDIDATES.map(async (candidate) => {
      const file = resolve(SAFE_STORE_UI_CANDIDATE_DIR, candidate.file);
      const fileStat = await stat(file);
      return {
        file: candidate.file,
        bytes: fileStat.size,
        sha256: hashFile(file),
      };
    })),
  );

  const review = JSON.parse(await readFile(resolve(SAFE_STORE_UI_CANDIDATE_DIR, "technical-review.json"), "utf8"));
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.artifactKind, "hyeni-store-ui-technical-review");
  assert.equal(review.verdict, "TECHNICAL_REVIEW_PASSED");
  assert.equal(review.playUploadApproved, false);
  assert.equal(review.humanPolicyApprovalRequired, true);
  assert.equal(review.sourceManifest.path, "manifest.json");
  assert.equal(review.sourceManifest.sha256, hashManifestWithLf(manifestText));
  assert.deepEqual(review.sourceDist, manifest.sourceDist);
  assert.deepEqual(review.artifacts, manifest.artifacts);
  assert.ok(Object.values(review.checks).every((value) => value === true));
});
