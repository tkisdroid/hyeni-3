import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APPROVED_ACTION_SHAS = Object.freeze({
  "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-java": "d7793b545071e98d581d3bf084a51c3213318a07",
  "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
  "android-actions/setup-android": "9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407",
});

function assertPinnedExternalActions(workflow) {
  const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)]
    .map((match) => match[1]);
  assert.ok(references.length > 0, "검증할 외부 GitHub Action이 있어야 합니다.");

  const seenActions = new Set();
  for (const reference of references) {
    const match = reference.match(/^([^@]+)@([a-f0-9]{40})$/);
    assert.ok(match, `${reference}는 정확한 40자리 commit SHA로 고정해야 합니다.`);
    const [, action, sha] = match;
    assert.equal(sha, APPROVED_ACTION_SHAS[action], `${action}의 승인된 공식 SHA가 아닙니다.`);
    seenActions.add(action);
  }

  assert.deepEqual([...seenActions].sort(), Object.keys(APPROVED_ACTION_SHAS).sort());
}

function assertCheckoutCredentialsAreNotPersisted(workflow) {
  const checkoutSteps = workflow
    .split(/\r?\n(?=\s*-\s+name:)/)
    .filter((step) => /uses:\s*actions\/checkout@/.test(step));
  assert.ok(checkoutSteps.length > 0, "검증할 checkout step이 있어야 합니다.");
  for (const step of checkoutSteps) {
    assert.match(step, /^\s*persist-credentials:\s*false\s*$/m);
  }
}

test("출시 후보 CI는 앱 전체 검증과 Android unit·lint·APK를 모두 차단 게이트로 실행한다", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const workflow = readFileSync(new URL("../.github/workflows/release-candidate.yml", import.meta.url), "utf8");

  assert.equal(pkg.scripts.test, "node --test tests/*.test.*");
  assert.equal(pkg.scripts.verify, "npm run typecheck && npm run build && npm test");
  assert.equal(pkg.scripts["qa:browser"], "node scripts/final-browser-qa.mjs");
  assert.equal(pkg.scripts["qa:pwa-runtime"], "node scripts/pwa-runtime-qa.mjs");
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /npm run qa:browser --/);
  assert.match(workflow, /npm run qa:pwa-runtime --/);
  assert.match(workflow, /artifacts\/release-evidence\/browser-qa\/\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(workflow, /artifacts\/release-evidence\/pwa-runtime-qa\/\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.match(workflow, /always\(\).*steps\.app-verify\.outcome == 'success'.*steps\.dependency-audit\.outcome == 'success'.*!cancelled\(\)/);
  assert.match(workflow, /hyeni-ui-qa-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /VITE_KAKAO_APP_KEY/);
  assert.match(workflow, /testDebugUnitTest lintDebug assembleDebug bundleDebug/);
  assert.match(workflow, /create-pages-provenance\.mjs/);
  assert.match(workflow, /hyeni-pages-dist-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /dist\/\*\*/);
  assert.match(workflow, /include-hidden-files:\s*true/);
  assert.match(workflow, /create-aab-evidence\.mjs/);
  assert.match(workflow, /bundletool-all-\$BUNDLETOOL_VERSION\.jar/);
  assert.match(workflow, /675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c/);
  assert.match(workflow, /--zipalign/);
  assert.match(workflow, /--readelf/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);

  const publicKeyBindings = workflow.match(
    /VITE_KAKAO_APP_KEY:\s*\$\{\{ vars\.VITE_KAKAO_APP_KEY \|\| secrets\.VITE_KAKAO_APP_KEY \}\}/g,
  ) ?? [];
  assert.equal(publicKeyBindings.length, 2, "두 CI job 모두 공개 Kakao JS 키를 variable 우선으로 받아야 합니다.");
  assert.match(workflow, /GitHub Actions variable 또는 secret이 필요합니다\./);

  const appQuality = workflow.match(/\n  app-quality:[\s\S]*?\n  android-debug:/)?.[0] ?? "";
  assert.match(
    appQuality,
    /VITE_KAKAO_APP_KEY:\s*\$\{\{ vars\.VITE_KAKAO_APP_KEY \|\| secrets\.VITE_KAKAO_APP_KEY \}\}/,
  );
  assert.match(
    appQuality,
    /actions\/setup-java@[a-f0-9]{40}[\s\S]*?android-actions\/setup-android@[a-f0-9]{40}[\s\S]*?npm run verify/,
  );
  assert.match(appQuality, /chmod \+x android\/gradlew[\s\S]*?npm run verify/);
  assert.match(appQuality, /출시 필수 공개 키 확인[\s\S]*?npm run verify/);
  assert.match(
    execFileSync("git", ["ls-files", "-s", "--", "android/gradlew"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    }),
    /^100755 /,
  );

  const aabEvidence = readFileSync(
    new URL("../scripts/create-aab-evidence.mjs", import.meta.url),
    "utf8",
  );
  assert.match(aabEvidence, /const embeddedPublicRoot = resolve\(apkExtractRoot, "assets", "public"\)/);
  assert.match(aabEvidence, /embeddedPublic: hashDirectory\(embeddedPublicRoot\)/);
  assert.match(aabEvidence, /assertCapacitorWebAssetsMatchDist/);
  assert.match(aabEvidence, /ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES/);
  assert.match(aabEvidence, /assertArchiveEntriesSafe/);
  assert.match(workflow, /npx cap sync android[\s\S]*?create-aab-evidence\.mjs/);
});

// 과거에는 Worker 저장소(hyeni-1)를 sibling checkout했지만, Worker 정본이 이
// 저장소의 worker/ 디렉터리로 이관되어 앱과 같은 커밋에서 함께 검증된다.
test("앱 CI는 단일 저장소 checkout으로 실행되고 같은 커밋의 worker/ 정본을 확인한다", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-candidate.yml", import.meta.url), "utf8");

  assert.doesNotMatch(workflow, /HYENI_WORKER_REPOSITORY|HYENI_APP_REPOSITORY/);
  assert.doesNotMatch(workflow, /HYENI_CROSS_REPO_TOKEN/);
  assert.doesNotMatch(workflow, /path:\s*hyeni-1/);
  assert.match(workflow, /actual_app_sha.*EXPECTED_APP_SHA/s);
  assert.match(workflow, /worker\/wrangler\.toml/);
  assert.match(workflow, /WORKER_SOURCE_SHA=\$actual_app_sha/);
});

test("앱 CI 외부 Action은 승인된 공식 commit SHA로 고정하고 checkout 자격증명을 남기지 않는다", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-candidate.yml", import.meta.url), "utf8");

  assertPinnedExternalActions(workflow);
  assertCheckoutCredentialsAreNotPersisted(workflow);
});
