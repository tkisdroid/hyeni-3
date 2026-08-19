import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APPROVED_ACTION_SHAS = Object.freeze({
  "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-java": "d7793b545071e98d581d3bf084a51c3213318a07",
  "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
  "android-actions/setup-android": "9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407",
});

function assertPinnedExternalActions(workflows) {
  const references = workflows.flatMap((workflow) => (
    [...workflow.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)].map((match) => match[1])
  ));
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
  for (const step of checkoutSteps) {
    assert.match(step, /^\s*persist-credentials:\s*false\s*$/m);
  }
  return checkoutSteps.length;
}

test("Worker CI는 타입·전체 테스트·의존성 감사를 차단 게이트로 실행한다", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const workflow = readFileSync(new URL("../../.github/workflows/worker-quality.yml", import.meta.url), "utf8");

  assert.equal(pkg.scripts["typecheck:worker"], "tsc -p worker --noEmit");
  assert.equal(pkg.scripts["test:worker"], "node --test worker/tests/*.test.mjs");
  assert.match(workflow, /npm run typecheck:worker/);
  assert.match(workflow, /npm run test:worker/);
  assert.doesNotMatch(workflow, /npx tsc --noEmit/);
  assert.doesNotMatch(workflow, /node --test worker\/tests\/\*\.test\.mjs/);
  assert.match(workflow, /npx wrangler deploy --dry-run/);
  assert.match(workflow, /RUNNER_TEMP\/hyeni-worker-dry-run/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});

test("Worker 필수 검사는 변경 경로와 관계없이 모든 main PR에서 생성된다", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/worker-quality.yml", import.meta.url), "utf8");
  const pullRequestBlock = workflow.match(/\n  pull_request:\n([\s\S]*?)\n  workflow_dispatch:/)?.[1] ?? "";

  assert.match(pullRequestBlock, /branches:\s*\[main\]/);
  assert.doesNotMatch(
    pullRequestBlock,
    /paths:/,
    "필수 상태 검사가 생략되지 않도록 pull_request에는 경로 필터를 두지 않습니다.",
  );
});

// 과거 hyeni-1 시절에는 앱 저장소를 sibling checkout했지만, Worker 정본이 이
// 저장소의 worker/ 디렉터리로 이관되어 앱과 같은 커밋에서 함께 검증된다.
test("Worker CI는 단일 저장소 checkout으로 실행되고 교차 저장소 checkout이 없다", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/worker-quality.yml", import.meta.url), "utf8");

  assert.doesNotMatch(workflow, /HYENI_APP_REPOSITORY|HYENI_WORKER_REPOSITORY/);
  assert.doesNotMatch(workflow, /HYENI_CROSS_REPO_TOKEN/);
  assert.doesNotMatch(workflow, /path:\s*hyeni-1/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /actual_sha.*EXPECTED_SOURCE_SHA/s);
  assert.match(workflow, /working-directory:\s*worker/);
  assert.match(workflow, /paths:[\s\S]*?- "worker\/\*\*"/);
});

test("Worker·Android CI 외부 Action은 승인된 공식 commit SHA로 고정하고 checkout 자격증명을 남기지 않는다", () => {
  const workerWorkflow = readFileSync(new URL("../../.github/workflows/worker-quality.yml", import.meta.url), "utf8");
  const androidWorkflow = readFileSync(new URL("../../.github/workflows/release-candidate.yml", import.meta.url), "utf8");

  assertPinnedExternalActions([workerWorkflow, androidWorkflow]);
  const checkoutCount = assertCheckoutCredentialsAreNotPersisted(workerWorkflow)
    + assertCheckoutCredentialsAreNotPersisted(androidWorkflow);
  assert.equal(checkoutCount, 3);
});
