import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "com.hyeni.calendar";
const KOREA_OFFSET = "+09:00";
const CRASH_REASONS = new Map([
  [4, "java_crash"],
  [5, "native_crash"],
  [6, "anr"],
]);

export const AUTHORIZED_RELEASE_DEVICES = Object.freeze([
  Object.freeze({ label: "A17", role: "parent", serial: "RFKL40DP73J" }),
  Object.freeze({ label: "razr", role: "child", serial: "ZY22H9VTQD" }),
]);

function localTimestampToEpochMs(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})$/);
  if (!match) return null;
  const epochMs = Date.parse(`${match[1]}T${match[2]}${KOREA_OFFSET}`);
  return Number.isFinite(epochMs) ? epochMs : null;
}

export function parseApplicationExitInfo(text, { packageName = PACKAGE_NAME } = {}) {
  if (typeof text !== "string") return [];
  const blocks = text.split(/^\s*ApplicationExitInfo #\d+:\s*$/mu).slice(1);
  const records = [];
  for (const block of blocks) {
    const timestamp = block.match(/^\s*timestamp=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\b/mu)?.[1];
    const process = block.match(/^\s*process=([^\s]+)\s+reason=(\d+)\b/mu);
    if (!timestamp || !process || process[1] !== packageName) continue;
    const epochMs = localTimestampToEpochMs(timestamp);
    const reason = Number.parseInt(process[2], 10);
    if (epochMs === null || !Number.isSafeInteger(reason)) continue;
    records.push({ epochMs, reason });
  }
  return records;
}

export function summarizeApplicationExitInfo(records, sinceMs) {
  if (!Number.isFinite(sinceMs)) throw new TypeError("sinceMs가 유효하지 않습니다.");
  const summary = { javaCrash: 0, nativeCrash: 0, anr: 0 };
  for (const record of records) {
    if (!record || !Number.isFinite(record.epochMs) || record.epochMs < sinceMs) continue;
    const kind = CRASH_REASONS.get(record.reason);
    if (kind === "java_crash") summary.javaCrash += 1;
    if (kind === "native_crash") summary.nativeCrash += 1;
    if (kind === "anr") summary.anr += 1;
  }
  return {
    ...summary,
    totalCrashOrAnr: summary.javaCrash + summary.nativeCrash + summary.anr,
  };
}

function adb(serial, args) {
  const result = spawnSync("adb", ["-s", serial, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("승인된 Android 기기 조회에 실패했습니다.");
  return result.stdout;
}

function parseArguments(argv) {
  let since = null;
  let out = null;
  for (const arg of argv) {
    if (arg.startsWith("--since=")) since = arg.slice("--since=".length).trim();
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length).trim();
    else throw new Error(`지원하지 않는 인자입니다: ${arg}`);
  }
  if (!since) throw new Error("--since=<ISO 8601> 시작 시각이 필요합니다.");
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) throw new Error("--since 시각이 유효하지 않습니다.");
  if (out && resolve(ROOT_DIR, out) === ROOT_DIR) throw new Error("출력 파일 경로가 필요합니다.");
  return { since, sinceMs, out };
}

export function collectAuthorizedDeviceExitSummary({ since, sinceMs, adbImpl = adb }) {
  const devices = AUTHORIZED_RELEASE_DEVICES.map(({ label, role, serial }) => {
    if (adbImpl(serial, ["get-state"]).trim() !== "device") {
      throw new Error(`${label} 기기가 승인된 device 상태가 아닙니다.`);
    }
    const timezone = adbImpl(serial, ["shell", "getprop", "persist.sys.timezone"]).trim();
    if (timezone !== "Asia/Seoul") {
      throw new Error(`${label} 기기 시간대가 Asia/Seoul이 아닙니다.`);
    }
    const raw = adbImpl(serial, ["shell", "dumpsys", "activity", "exit-info", PACKAGE_NAME]);
    return {
      label,
      role,
      ...summarizeApplicationExitInfo(parseApplicationExitInfo(raw), sinceMs),
    };
  });
  const totalCrashOrAnr = devices.reduce((sum, device) => sum + device.totalCrashOrAnr, 0);
  return {
    schemaVersion: 1,
    artifactKind: "hyeni-android-exit-summary",
    capturedAt: new Date().toISOString(),
    since,
    packageName: PACKAGE_NAME,
    devices,
    assessment: {
      verdict: totalCrashOrAnr === 0 ? "PASS" : "FAIL",
      totalCrashOrAnr,
    },
    privacy: {
      rawDumpsysStored: false,
      descriptionsStored: false,
      tracesStored: false,
      serialsStored: false,
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const report = collectAuthorizedDeviceExitSummary(args);
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) {
      const outputPath = resolve(ROOT_DIR, args.out);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, output, { encoding: "utf8", flag: "wx" });
    }
    process.stdout.write(output);
    if (report.assessment.verdict !== "PASS") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Android 종료 이력 조회 실패"}\n`);
    process.exitCode = 1;
  }
}
