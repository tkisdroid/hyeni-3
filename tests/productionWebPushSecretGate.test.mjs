import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = resolve(import.meta.dirname, "..");
const gatePath = resolve(rootDir, "scripts", "verify-production-web-push-secrets.mjs");

function runGate(inventory) {
  const tempDir = mkdtempSync(resolve(tmpdir(), "hyeni-web-push-secret-gate-"));
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
  const tempDir = mkdtempSync(resolve(tmpdir(), "hyeni-web-push-wrangler-"));
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

test("프로덕션 Web Push 게이트는 VAPID 두 secret 이름이 모두 있을 때만 성공한다", () => {
  const result = runGate([
    { name: "VAPID_PUBLIC_KEY", type: "secret_text" },
    { name: "VAPID_PRIVATE_KEY", type: "secret_text" },
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /프로덕션 Web Push 필수 secret 2개 확인 완료/);
});

test("프로덕션 Web Push 게이트는 Wrangler inventory를 직접 검사한다", () => {
  const result = runGateThroughWrangler([
    { name: "VAPID_PUBLIC_KEY", type: "secret_text" },
    { name: "VAPID_PRIVATE_KEY", type: "secret_text" },
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /프로덕션 Web Push 필수 secret 2개 확인 완료/);
});

test("프로덕션 Web Push 게이트는 누락 이름만 알리고 secret 값은 출력하지 않는다", () => {
  const result = runGateThroughWrangler([
    { name: "VAPID_PUBLIC_KEY", type: "secret_text", value: "절대-출력-금지" },
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /VAPID_PRIVATE_KEY/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /절대-출력-금지/);
});
