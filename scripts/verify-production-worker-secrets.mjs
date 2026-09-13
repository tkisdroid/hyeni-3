import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_WORKER_SECRETS = Object.freeze([
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "GOOGLE_PLAY_RTDN_AUDIENCE",
  "GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "LOCATION_AUDIT_CURSOR_SECRET",
  "PREMIUM_FUNNEL_HASH_SECRET",
  "WEB_BILLING_KEY_ENCRYPTION_SECRET",
]);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");

function readOption(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function readWranglerInventory(argv) {
  const wranglerCli = resolve(
    readOption(argv, "--wrangler-cli")
      ?? resolve(rootDir, "node_modules", "wrangler", "bin", "wrangler.js"),
  );
  const configPath = resolve(
    readOption(argv, "--config") ?? resolve(rootDir, "worker", "wrangler.toml"),
  );
  const result = spawnSync(
    process.execPath,
    [wranglerCli, "secret", "list", "--config", configPath],
    {
      cwd: tmpdir(),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error("Wrangler에서 Worker secret 이름 목록을 읽지 못했습니다.");
  }
  return JSON.parse(result.stdout);
}

let inventory;
try {
  const argv = process.argv.slice(2);
  const inventoryPath = readOption(argv, "--inventory-file");
  inventory = inventoryPath
    ? JSON.parse(readFileSync(resolve(inventoryPath), "utf8"))
    : readWranglerInventory(argv);
  if (!Array.isArray(inventory)) {
    throw new Error("Worker secret inventory 형식이 올바르지 않습니다.");
  }
} catch {
  console.error("Worker secret inventory를 읽을 수 없습니다.");
  process.exit(1);
}

const names = new Set(
  inventory
    .filter((entry) => entry?.type === "secret_text" && typeof entry?.name === "string")
    .map((entry) => entry.name),
);
const missing = REQUIRED_WORKER_SECRETS.filter((name) => !names.has(name));

if (missing.length > 0) {
  console.error(`프로덕션 Worker HOLD: 누락된 secret 이름: ${missing.join(", ")}`);
  process.exit(2);
}

console.log("프로덕션 Worker 필수 secret 10개 확인 완료.");
