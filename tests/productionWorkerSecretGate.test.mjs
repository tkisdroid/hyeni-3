import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const gatePath = resolve(rootDir, "scripts", "verify-production-worker-secrets.mjs");
const requiredSecretNames = [
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "GOOGLE_PLAY_RTDN_AUDIENCE",
  "GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "LOCATION_AUDIT_CURSOR_SECRET",
  "PREMIUM_FUNNEL_HASH_SECRET",
  "WEB_BILLING_KEY_ENCRYPTION_SECRET",
];

function runGate(inventory) {
  const tempDir = mkdtempSync(resolve(tmpdir(), "hyeni-worker-secret-gate-"));
  const inventoryPath = resolve(tempDir, "inventory.json");
  writeFileSync(inventoryPath, JSON.stringify(inventory), "utf8");
  try {
    return spawnSync(process.execPath, [gatePath, "--inventory-file", inventoryPath], {
      cwd: rootDir,
      encoding: "utf8",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runGateThroughWrangler(inventory) {
  const tempDir = mkdtempSync(resolve(tmpdir(), "hyeni-worker-wrangler-"));
  const wranglerPath = resolve(tempDir, "fake-wrangler.mjs");
  writeFileSync(
    wranglerPath,
    `process.stdout.write(${JSON.stringify(JSON.stringify(inventory))});`,
    "utf8",
  );
  try {
    return spawnSync(process.execPath, [gatePath, "--wrangler-cli", wranglerPath], {
      cwd: rootDir,
      encoding: "utf8",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test("Android 전용 결제 정책의 프로덕션 Worker 게이트는 필수 secret 이름 8개가 모두 있을 때만 성공한다", () => {
  const result = runGate(
    requiredSecretNames.map((name) => ({ name, type: "secret_text" })),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /프로덕션 Worker 필수 secret 8개 확인 완료/);
});

test("프로덕션 Worker 게이트는 누락 이름만 알리고 secret 값은 출력하지 않는다", () => {
  const inventory = requiredSecretNames
    .filter((name) => !["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].includes(name))
    .map((name) => ({ name, type: "secret_text", value: "절대-출력-금지" }));
  const result = runGateThroughWrangler(inventory);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /VAPID_PUBLIC_KEY/);
  assert.match(result.stderr, /VAPID_PRIVATE_KEY/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /절대-출력-금지/);
});

test("프로덕션 Worker 게이트는 inventory를 읽지 못하면 일반 오류로 닫힌다", () => {
  const result = runGate({ invalid: true, value: "절대-출력-금지" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Worker secret inventory를 읽을 수 없습니다/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /절대-출력-금지/);
});
