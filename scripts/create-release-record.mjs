import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  fileEvidence,
  hashDirectory,
  hashFile,
  isReleaseVersionPolicySafe,
  normalizeCommit,
  normalizeSha256,
  readAppReleaseMetadata,
  readGitState,
  sha256,
} from "./release-evidence.mjs";
import {
  ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
  APPROVED_BUNDLETOOL_SHA256,
  APPROVED_BUNDLETOOL_VERSION,
  CAPACITOR_GENERATED_PUBLIC_FILES,
  CAPACITOR_PUBLIC_PROJECTION_VERSION,
  EMPTY_FILE_SHA256,
  assertNoCapacitorGeneratedFileCollisions,
} from "./create-aab-evidence.mjs";
import { inspectKnownGoodPagesArchive } from "./pages-archive-evidence.mjs";
import {
  ANDROID_MANIFEST_POLICY_VERSION,
  ANDROID_MONITORING_TOOL_VALUE,
  expectedReleasePermissionNames,
} from "./android-manifest-policy.mjs";

export { hashDirectory, hashFile, readGitState } from "./release-evidence.mjs";

const REQUIRED_PLAY_TRACKS = ["internal", "closed", "open", "production"];
const INVENTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LAUNCH_APPROVAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const D1_BOOKMARK_MAX_AGE_MS = 10 * 60 * 1000;
const D1_BOOKMARK_CAPTURE_MAX_DURATION_MS = 2 * 60 * 1000;
const EVIDENCE_FUTURE_SKEW_MS = 10 * 60 * 1000;
const D1_TIME_TRAVEL_BOOKMARK_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/;
const D1_DATABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const D1_BOOKMARK_EVIDENCE_TOP_LEVEL_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactKind",
  "capturedAt",
  "captureStartedAt",
  "captureCompletedAt",
  "appSourceCommit",
  "workerSourceCommit",
  "database",
  "request",
  "readOnlyPreflight",
  "bookmark",
]);
const D1_BOOKMARK_DATABASE_FIELDS = Object.freeze([
  "binding",
  "name",
  "id",
]);
const D1_BOOKMARK_REQUEST_FIELDS = Object.freeze([
  "operation",
  "mode",
  "responseFormat",
  "wranglerVersion",
  "executionCwd",
  "configPath",
  "cliPath",
]);
const D1_BOOKMARK_PREFLIGHT_FIELDS = Object.freeze([
  "capturedAt",
  "sqlPath",
  "sqlSha256",
  "responsePath",
  "responseSha256",
  "resultRowCount",
  "meta",
  "summary",
]);
const D1_BOOKMARK_PREFLIGHT_META_FIELDS = Object.freeze([
  "changes",
  "changedDb",
  "rowsWritten",
]);
const D1_BOOKMARK_PREFLIGHT_SUMMARY_FIELDS = Object.freeze([
  "requiredObjects",
  "presentObjects",
  "missingObjects",
  "duplicateGroups",
  "duplicateRows",
  "rowsRemovedByMerge",
  "hasAiScheduleLimitSource",
]);

const LAUNCH_APPROVAL_BOOLEAN_FIELDS = Object.freeze({
  operationalReadiness: Object.freeze([
    "migrationRehearsalPassed",
    "productionMigrationReadbackPassed",
    "healthReadinessReadbackPassed",
  ]),
  aiProduction: Object.freeze([
    "previousOpenAiKeyRevoked",
    "productionOpenAiBindingReadbackPassed",
    "productionLunaModelReadbackPassed",
    "lunaLiveCanaryPassed",
  ]),
  paymentE2e: Object.freeze([
    "googlePlayPurchasePassed",
    "googlePlayRestorePassed",
    "googlePlayRenewalPassed",
    "googlePlayCancellationPassed",
    "googlePlayRefundPassed",
    "tossPurchasePassed",
    "tossRestorePassed",
    "tossRenewalPassed",
    "tossCancellationPassed",
    "tossRefundPassed",
    "crossProviderDuplicateChargePreventionPassed",
    "crossProviderEntitlementConsistencyPassed",
  ]),
  ugcSafety: Object.freeze([
    "reportFlowPassed",
    "blockFlowPassed",
    "operatorReviewPassed",
    "appealFlowPassed",
  ]),
  legalAndPolicy: Object.freeze([
    "termsAndPrivacyApproved",
    "playDataSafetyApproved",
    "childLocationLegalReviewApproved",
    "familiesPolicyApproved",
  ]),
  clientStateChangingE2e: Object.freeze([
    "iphonePwaStateChangingE2ePassed",
    "a17ParentNativeStateChangingE2ePassed",
    "razrChildNativeStateChangingE2ePassed",
    "crossDeviceCriticalFlowPassed",
  ]),
  storeReadiness: Object.freeze([
    "playConsoleConfigurationApproved",
    "piiFreeStoreAssetsApproved",
    "fullScreenIntentDeclarationApproved",
    "foregroundServiceDeclarationApproved",
    "monitoringToolDeclarationApproved",
    "targetAudienceAndIarcApproved",
    "playAppSigningAndAssetLinksApproved",
  ]),
  launchOperations: Object.freeze([
    "firstHourMonitoringPlanApproved",
    "rollbackDrillPassed",
    "knownGoodRecoveryVerified",
  ]),
});

const LAUNCH_APPROVAL_SECTION_NAMES = Object.freeze(
  Object.keys(LAUNCH_APPROVAL_BOOLEAN_FIELDS),
);
const LAUNCH_APPROVAL_TOP_LEVEL_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactKind",
  "capturedAt",
  "appSourceCommit",
  "workerSourceCommit",
  "fixedPricingKrw",
  ...LAUNCH_APPROVAL_SECTION_NAMES,
]);
const SENSITIVE_EVIDENCE_FIELD_PATTERN = /(^|[-_])(?:secret|token|password|credential|authorization|api[-_]?key|user[-_]?id|family[-_]?id|account[-_]?id|device[-_]?id|uid)(?=$|[-_])/i;
const SECRET_LIKE_VALUE_PATTERNS = Object.freeze([
  /^bearer\s+\S+/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /^(?:sk|rk)-[A-Za-z0-9_-]{12,}$/i,
  /^(?:pk|sk)_(?:live|test)_[A-Za-z0-9_-]{12,}$/i,
]);

function envText(env, key) {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addMissing(blockers, value, label) {
  if (!value) blockers.push(`${label} 증거가 없습니다.`);
}

function resolveInputPath(root, value) {
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

const JSON_EVIDENCE_STABLE_STAT_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "nlink",
  "uid",
  "gid",
  "rdev",
  "size",
  "blksize",
  "blocks",
  "mtimeNs",
  "ctimeNs",
  "birthtimeNs",
]);

const DEFAULT_JSON_EVIDENCE_IO = Object.freeze({
  statFile: (path) => statSync(path, { bigint: true }),
  openFile: (path) => openSync(path, "r"),
  statDescriptor: (descriptor) => fstatSync(descriptor, { bigint: true }),
  readFile: (descriptor) => readFileSync(descriptor),
  closeFile: (descriptor) => closeSync(descriptor),
});

function sameStableFileState(left, right) {
  return JSON_EVIDENCE_STABLE_STAT_FIELDS.every((field) => left[field] === right[field]);
}

function isMissingFileError(error) {
  return error && typeof error === "object" && (
    error.code === "ENOENT" || error.code === "ENOTDIR"
  );
}

export function readJsonEvidence(path, root, io = {}) {
  if (!path) return { file: null, value: null, error: null };
  const operations = {
    ...DEFAULT_JSON_EVIDENCE_IO,
    ...(io && typeof io === "object" ? io : {}),
  };
  let descriptor = null;
  let pathObserved = false;
  let result = null;

  try {
    const pathBefore = operations.statFile(path);
    pathObserved = true;
    if (!pathBefore.isFile()) {
      result = { file: null, value: null, error: "파일을 찾을 수 없습니다." };
    } else {
      descriptor = operations.openFile(path);
      const descriptorBefore = operations.statDescriptor(descriptor);
      const buffer = operations.readFile(descriptor);
      const descriptorAfter = operations.statDescriptor(descriptor);
      const pathAfter = operations.statFile(path);
      const states = [pathBefore, descriptorBefore, descriptorAfter, pathAfter];
      const stable = Buffer.isBuffer(buffer)
        && states.every((state) => state.isFile())
        && states.slice(1).every((state) => sameStableFileState(pathBefore, state))
        && BigInt(buffer.byteLength) === pathBefore.size;

      if (!stable) {
        result = {
          file: null,
          value: null,
          error: "evidence 파일이 읽는 동안 변경되었습니다.",
        };
      } else {
        const file = {
          path: relative(root, path).replaceAll("\\", "/"),
          bytes: buffer.byteLength,
          mtime: pathBefore.mtime.toISOString(),
          sha256: sha256(buffer),
        };
        try {
          result = { file, value: JSON.parse(buffer.toString("utf8")), error: null };
        } catch {
          result = { file, value: null, error: "JSON 형식이 올바르지 않습니다." };
        }
      }
    }
  } catch (error) {
    result = {
      file: null,
      value: null,
      error: isMissingFileError(error)
        ? (pathObserved
          ? "evidence 파일이 읽는 동안 변경되었습니다."
          : "파일을 찾을 수 없습니다.")
        : "evidence 파일을 안전하게 읽을 수 없습니다.",
    };
  } finally {
    if (descriptor !== null) {
      try {
        operations.closeFile(descriptor);
      } catch {
        result = {
          file: null,
          value: null,
          error: "evidence 파일을 안전하게 읽을 수 없습니다.",
        };
      }
    }
  }

  return result;
}

function validDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateFreshDateTime({ blockers, label, value, recordGeneratedAt, maxAgeMs }) {
  if (!validDateTime(value)) {
    blockers.push(`${label} 시각이 유효하지 않습니다.`);
    return;
  }
  const evidenceMs = Date.parse(value);
  const recordMs = Date.parse(recordGeneratedAt);
  if (!Number.isFinite(recordMs)) {
    blockers.push("release record 생성 시각이 유효하지 않습니다.");
    return;
  }
  if (evidenceMs > recordMs + EVIDENCE_FUTURE_SKEW_MS) {
    blockers.push(`${label} 시각이 release record보다 미래입니다.`);
  }
  if (recordMs - evidenceMs > maxAgeMs) {
    blockers.push(`${label} 증거가 허용 유효기간을 지났습니다.`);
  }
}

function nonEmptyStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function normalizedEvidenceFieldName(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function findSensitiveEvidencePaths(value, path = "$", findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveEvidencePaths(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (!value || typeof value !== "object") return findings;
  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (SENSITIVE_EVIDENCE_FIELD_PATTERN.test(normalizedEvidenceFieldName(key))) {
      findings.push(nestedPath);
    }
    findSensitiveEvidencePaths(nestedValue, nestedPath, findings);
  }
  return findings;
}

function hasSecretLikeEvidenceValue(value) {
  if (typeof value === "string") {
    return SECRET_LIKE_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
  }
  if (Array.isArray(value)) return value.some(hasSecretLikeEvidenceValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasSecretLikeEvidenceValue);
}

function exactObjectFields(value, expectedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const expected = [...expectedFields].sort((left, right) => left.localeCompare(right, "en"));
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function tomlStringField(section, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`^\\s*${escaped}\\s*=\\s*\"([^\"\\r\\n]+)\"\\s*(?:#.*)?$`, "m"));
  return match?.[1]?.trim() || null;
}

export function readWorkerD1Config(workerRoot) {
  const configPath = resolve(workerRoot, "worker", "wrangler.toml");
  const source = readFileSync(configPath, "utf8");
  const sectionStarts = [...source.matchAll(/^\s*\[\[d1_databases\]\]\s*(?:#.*)?$/gm)];
  const matches = [];

  for (const [index, sectionStart] of sectionStarts.entries()) {
    const start = sectionStart.index + sectionStart[0].length;
    const remainder = source.slice(start);
    const nextHeaderOffset = remainder.search(/^\s*\[/m);
    const end = nextHeaderOffset < 0 ? source.length : start + nextHeaderOffset;
    const section = source.slice(start, end);
    const binding = tomlStringField(section, "binding");
    if (binding !== "DB") continue;
    matches.push({
      binding,
      name: tomlStringField(section, "database_name"),
      id: tomlStringField(section, "database_id"),
      sectionIndex: index,
    });
  }

  if (matches.length !== 1) {
    throw new Error("wrangler.toml에서 binding=DB인 D1 설정을 정확히 하나 찾아야 합니다.");
  }
  const [{ binding, name, id }] = matches;
  if (!name || !id || !D1_DATABASE_UUID_PATTERN.test(id)) {
    throw new Error("wrangler.toml의 DB database_name 또는 database_id가 올바르지 않습니다.");
  }
  return { binding, name, id };
}

function validWranglerTimeTravelVersion(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 4);
}

function validateD1BookmarkEvidence({
  blockers,
  evidence,
  expectedHash,
  appGit,
  workerGit,
  workerD1Config,
  preflightSql,
  appRoot,
  jsonEvidenceIo,
  recordGeneratedAt,
}) {
  if (!evidence.file) {
    blockers.push(
      expectedHash
        ? "D1 Time Travel bookmark machine evidence 파일이 없습니다."
        : "D1 Time Travel bookmark machine evidence 파일과 expected SHA-256이 없습니다.",
    );
    if (evidence.error) {
      blockers.push(`D1 Time Travel bookmark evidence를 읽을 수 없습니다: ${evidence.error}`);
    }
    return null;
  }
  validateExpectedEvidenceHash({
    blockers,
    label: "D1 Time Travel bookmark",
    expectedHash,
    evidence,
  });
  const value = evidence.value;
  if (!value) return null;

  if (!exactObjectFields(value, D1_BOOKMARK_EVIDENCE_TOP_LEVEL_FIELDS)) {
    blockers.push("D1 Time Travel bookmark evidence 최상위 필드가 strict schema와 다릅니다.");
  }
  if (value.schemaVersion !== 1 || value.artifactKind !== "hyeni-d1-time-travel-bookmark") {
    blockers.push("D1 Time Travel bookmark evidence schema 또는 artifactKind가 올바르지 않습니다.");
  }

  validateFreshDateTime({
    blockers,
    label: "D1 Time Travel bookmark capturedAt",
    value: value.capturedAt,
    recordGeneratedAt,
    maxAgeMs: D1_BOOKMARK_MAX_AGE_MS,
  });
  const startedAtMs = validDateTime(value.captureStartedAt)
    ? Date.parse(value.captureStartedAt)
    : Number.NaN;
  const completedAtMs = validDateTime(value.captureCompletedAt)
    ? Date.parse(value.captureCompletedAt)
    : Number.NaN;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    blockers.push("D1 Time Travel bookmark 캡처 시작·완료 시각이 유효하지 않습니다.");
  } else {
    if (completedAtMs < startedAtMs) {
      blockers.push("D1 Time Travel bookmark 캡처 완료 시각이 시작 시각보다 빠릅니다.");
    }
    if (completedAtMs - startedAtMs > D1_BOOKMARK_CAPTURE_MAX_DURATION_MS) {
      blockers.push("D1 Time Travel bookmark 캡처 시간이 2분을 초과했습니다.");
    }
    if (value.capturedAt !== value.captureCompletedAt) {
      blockers.push("D1 Time Travel bookmark capturedAt은 실제 캡처 완료 시각과 같아야 합니다.");
    }
  }

  const appSourceCommit = normalizeCommit(value.appSourceCommit);
  const workerSourceCommit = normalizeCommit(value.workerSourceCommit);
  if (!appSourceCommit || appSourceCommit !== appGit.head) {
    blockers.push("D1 Time Travel bookmark evidence app commit이 현재 후보와 다릅니다.");
  }
  if (!workerSourceCommit || workerSourceCommit !== workerGit.head) {
    blockers.push("D1 Time Travel bookmark evidence Worker commit이 현재 후보와 다릅니다.");
  }

  if (!exactObjectFields(value.database, D1_BOOKMARK_DATABASE_FIELDS)) {
    blockers.push("D1 Time Travel bookmark evidence database 필드가 strict schema와 다릅니다.");
  }
  if (
    !workerD1Config
    || value.database?.binding !== workerD1Config.binding
    || value.database?.name !== workerD1Config.name
    || value.database?.id !== workerD1Config.id
  ) {
    blockers.push("D1 Time Travel bookmark evidence가 현재 Worker의 정확한 D1 DB와 다릅니다.");
  }

  if (!exactObjectFields(value.request, D1_BOOKMARK_REQUEST_FIELDS)) {
    blockers.push("D1 Time Travel bookmark evidence request 필드가 strict schema와 다릅니다.");
  }
  if (
    value.request?.operation !== "d1-time-travel-info"
    || value.request?.mode !== "current"
    || value.request?.responseFormat !== "json"
    || !validWranglerTimeTravelVersion(value.request?.wranglerVersion)
    || value.request?.executionCwd !== "hyeni-3"
    || value.request?.configPath !== "worker/wrangler.toml"
    || value.request?.cliPath !== "node_modules/wrangler/bin/wrangler.js"
  ) {
    blockers.push("D1 Time Travel bookmark evidence가 현재 bookmark JSON 캡처 계약과 다릅니다.");
  }

  const preflight = value.readOnlyPreflight;
  if (!exactObjectFields(preflight, D1_BOOKMARK_PREFLIGHT_FIELDS)) {
    blockers.push("D1 Time Travel bookmark evidence readOnlyPreflight 필드가 strict schema와 다릅니다.");
  }
  const preflightCapturedAtMs = validDateTime(preflight?.capturedAt)
    ? Date.parse(preflight.capturedAt)
    : Number.NaN;
  if (!Number.isFinite(preflightCapturedAtMs)) {
    blockers.push("D1 read-only preflight 캡처 시각이 유효하지 않습니다.");
  } else if (Number.isFinite(startedAtMs)) {
    if (preflightCapturedAtMs > startedAtMs) {
      blockers.push("D1 read-only preflight는 bookmark 캡처보다 먼저 완료되어야 합니다.");
    }
    if (startedAtMs - preflightCapturedAtMs > 5 * 60 * 1000) {
      blockers.push("D1 read-only preflight와 bookmark 캡처 간격이 5분을 초과했습니다.");
    }
  }
  if (
    preflight?.sqlPath !== "worker/ops/release-d1-readonly-preflight.sql"
    || !preflightSql
    || normalizeSha256(preflight?.sqlSha256) !== preflightSql.sha256
  ) {
    blockers.push("D1 read-only preflight SQL이 현재 Worker 정본과 다릅니다.");
  }
  if (!normalizeSha256(preflight?.responseSha256)) {
    blockers.push("D1 read-only preflight 원본 응답 SHA-256이 유효하지 않습니다.");
  }
  if (preflight?.resultRowCount !== 1) {
    blockers.push("D1 read-only preflight는 결과 행을 정확히 1개 반환해야 합니다.");
  }
  if (!exactObjectFields(preflight?.meta, D1_BOOKMARK_PREFLIGHT_META_FIELDS)) {
    blockers.push("D1 read-only preflight meta 필드가 strict schema와 다릅니다.");
  }
  if (
    preflight?.meta?.changes !== 0
    || preflight?.meta?.changedDb !== false
    || preflight?.meta?.rowsWritten !== 0
  ) {
    blockers.push("D1 read-only preflight가 changes=0·changed_db=false·rows_written=0을 만족하지 않습니다.");
  }
  if (!exactObjectFields(preflight?.summary, D1_BOOKMARK_PREFLIGHT_SUMMARY_FIELDS)) {
    blockers.push("D1 read-only preflight summary 필드가 strict schema와 다릅니다.");
  }
  const summaryValues = [
    preflight?.summary?.requiredObjects,
    preflight?.summary?.presentObjects,
    preflight?.summary?.missingObjects,
    preflight?.summary?.duplicateGroups,
    preflight?.summary?.duplicateRows,
    preflight?.summary?.rowsRemovedByMerge,
  ];
  const summaryCountsValid = summaryValues.every(
    (count) => Number.isSafeInteger(count) && count >= 0,
  );
  const aiScheduleLimitSourceValid = preflight?.summary?.hasAiScheduleLimitSource === 1;
  if (
    !summaryCountsValid
    || preflight.summary.requiredObjects
      !== preflight.summary.presentObjects + preflight.summary.missingObjects
    || preflight.summary.rowsRemovedByMerge
      !== preflight.summary.duplicateRows - preflight.summary.duplicateGroups
  ) {
    blockers.push("D1 read-only preflight 익명 집계 불변식이 올바르지 않습니다.");
  }
  if (!aiScheduleLimitSourceValid) {
    blockers.push("D1 read-only preflight의 has_ai_schedule_limit_source가 1이 아닙니다.");
  }

  let preflightResponseFile = null;
  let preflightResponse = null;
  if (
    typeof preflight?.responsePath !== "string"
    || !/^artifacts\/release-evidence\/d1-readonly-preflight(?:-\d{8}-\d{6})?\.json$/.test(preflight.responsePath)
  ) {
    blockers.push("D1 read-only preflight 원본 응답 경로가 안전한 release evidence 경로가 아닙니다.");
  } else {
    const responsePath = resolveInputPath(appRoot, preflight.responsePath);
    const responseEvidence = readJsonEvidence(responsePath, appRoot, jsonEvidenceIo);
    preflightResponseFile = responseEvidence.file;
    preflightResponse = responseEvidence.value;
    if (!preflightResponseFile) {
      blockers.push("D1 read-only preflight 원본 응답 파일이 없습니다.");
      if (responseEvidence.error) {
        blockers.push(`D1 read-only preflight 원본 응답을 읽을 수 없습니다: ${responseEvidence.error}`);
      }
    } else if (preflightResponseFile.sha256 !== normalizeSha256(preflight.responseSha256)) {
      blockers.push("D1 read-only preflight 원본 응답 파일 SHA-256이 evidence와 다릅니다.");
    }
  }
  const responseBatch = Array.isArray(preflightResponse) ? preflightResponse : [];
  const responseEntry = responseBatch.length === 1 ? responseBatch[0] : null;
  const responseRows = Array.isArray(responseEntry?.results) ? responseEntry.results : [];
  const responseRow = responseRows.length === 1 ? responseRows[0] : null;
  const responseSummary = responseRow ? {
    requiredObjects: responseRow.required_objects,
    presentObjects: responseRow.present_objects,
    missingObjects: responseRow.missing_objects,
    duplicateGroups: responseRow.duplicate_groups,
    duplicateRows: responseRow.duplicate_rows,
    rowsRemovedByMerge: responseRow.rows_removed_by_merge,
    hasAiScheduleLimitSource: responseRow.has_ai_schedule_limit_source,
  } : null;
  const responseSummaryMatches = responseSummary
    && D1_BOOKMARK_PREFLIGHT_SUMMARY_FIELDS.every(
      (field) => responseSummary[field] === preflight?.summary?.[field],
    );
  if (
    preflightResponse
    && (
      responseBatch.length !== 1
      || responseEntry?.success !== true
      || responseRows.length !== 1
      || responseEntry?.meta?.changes !== 0
      || responseEntry?.meta?.changed_db !== false
      || responseEntry?.meta?.rows_written !== 0
      || !responseSummaryMatches
    )
  ) {
    blockers.push("D1 read-only preflight 원본 응답이 단일 행·무변경 meta·익명 summary evidence와 다릅니다.");
  }
  if (typeof value.bookmark !== "string" || !D1_TIME_TRAVEL_BOOKMARK_PATTERN.test(value.bookmark)) {
    blockers.push("D1 Time Travel bookmark가 Cloudflare 현재 형식과 다릅니다.");
  }

  return {
    capturedAt: validDateTime(value.capturedAt) ? value.capturedAt : null,
    appSourceCommit,
    workerSourceCommit,
    database: workerD1Config && value.database?.id === workerD1Config.id
      ? { ...workerD1Config }
      : null,
    requestMode: value.request?.mode === "current" ? "current" : null,
    wranglerVersion: validWranglerTimeTravelVersion(value.request?.wranglerVersion)
      ? value.request.wranglerVersion
      : null,
    readOnlyPreflight: summaryCountsValid && aiScheduleLimitSourceValid && preflight?.meta?.changes === 0
      && preflight?.meta?.changedDb === false && preflight?.meta?.rowsWritten === 0
      ? {
        capturedAt: preflight.capturedAt,
        sqlSha256: normalizeSha256(preflight.sqlSha256),
        responsePath: preflightResponseFile?.path ?? null,
        responseSha256: normalizeSha256(preflight.responseSha256),
        summary: { ...preflight.summary },
      }
      : null,
    bookmark: typeof value.bookmark === "string" && D1_TIME_TRAVEL_BOOKMARK_PATTERN.test(value.bookmark)
      ? value.bookmark
      : null,
  };
}

function validLaunchEvidenceReferences(value) {
  return nonEmptyStrings(value)
    && value.every((reference) => (
      reference === reference.trim()
      && /^evidence-store:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{2,198}$/.test(reference)
    ))
    && new Set(value).size === value.length;
}

function validObserverRole(value) {
  return typeof value === "string"
    && /^(?:release|ops|incident|policy)-[a-z0-9][a-z0-9-]{1,55}$/.test(value)
    && !/(^|-)(?:user|uid|uuid|account)(?:-|$)/.test(value)
    && !/^[a-f0-9]{40,64}$/.test(value)
    && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/.test(value);
}

function validateLaunchApprovalEvidence({
  blockers,
  evidence,
  expectedHash,
  appGit,
  workerGit,
  recordGeneratedAt,
  expectedPrimaryObserver,
}) {
  validateExpectedEvidenceHash({
    blockers,
    label: "launch approval",
    expectedHash,
    evidence,
  });
  if (!evidence.file) {
    blockers.push("launch approval evidence 파일이 없습니다.");
    return null;
  }
  const value = evidence.value;
  if (!value) return null;

  if (findSensitiveEvidencePaths(value).length > 0 || hasSecretLikeEvidenceValue(value)) {
    blockers.push("launch approval evidence에 비밀값·token·사용자 ID 필드를 넣을 수 없습니다.");
  }
  if (!exactObjectFields(value, LAUNCH_APPROVAL_TOP_LEVEL_FIELDS)) {
    blockers.push("launch approval evidence 최상위 필드가 strict schema와 다릅니다.");
  }
  if (value.schemaVersion !== 1 || value.artifactKind !== "hyeni-launch-approval") {
    blockers.push("launch approval evidence schema 또는 artifactKind가 올바르지 않습니다.");
  }
  validateFreshDateTime({
    blockers,
    label: "launch approval capturedAt",
    value: value.capturedAt,
    recordGeneratedAt,
    maxAgeMs: LAUNCH_APPROVAL_MAX_AGE_MS,
  });

  const appSourceCommit = normalizeCommit(value.appSourceCommit);
  const workerSourceCommit = normalizeCommit(value.workerSourceCommit);
  if (!appSourceCommit || appSourceCommit !== appGit.head) {
    blockers.push("launch approval app source commit이 현재 app commit과 다릅니다.");
  }
  if (!workerSourceCommit || workerSourceCommit !== workerGit.head) {
    blockers.push("launch approval Worker source commit이 현재 Worker commit과 다릅니다.");
  }
  if (
    !exactObjectFields(value.fixedPricingKrw, ["monthly", "annual"])
    || value.fixedPricingKrw?.monthly !== 4900
    || value.fixedPricingKrw?.annual !== 39000
  ) {
    blockers.push("launch approval 가격이 월 4,900원·연 39,000원과 다릅니다.");
  }

  const referenceCounts = {};
  for (const sectionName of LAUNCH_APPROVAL_SECTION_NAMES) {
    const section = value[sectionName];
    const booleanFields = LAUNCH_APPROVAL_BOOLEAN_FIELDS[sectionName];
    const extraFields = sectionName === "launchOperations"
      ? ["primaryObserver", "alternateObserver"]
      : [];
    if (!exactObjectFields(section, [...booleanFields, ...extraFields, "references"])) {
      blockers.push(`launch approval ${sectionName} 필드가 strict schema와 다릅니다.`);
    }
    for (const field of booleanFields) {
      if (section?.[field] !== true) {
        blockers.push(`launch approval ${sectionName}.${field}가 true가 아닙니다.`);
      }
    }
    if (!validLaunchEvidenceReferences(section?.references)) {
      blockers.push(`launch approval ${sectionName} evidence reference가 비어 있거나 안전하지 않습니다.`);
    }
    referenceCounts[sectionName] = Array.isArray(section?.references)
      ? section.references.length
      : 0;
  }

  const launchOperations = value.launchOperations;
  const primaryObserver = launchOperations?.primaryObserver;
  const alternateObserver = launchOperations?.alternateObserver;
  if (!validObserverRole(primaryObserver) || !validObserverRole(alternateObserver)) {
    blockers.push("launch approval 첫 60분 관측자는 사용자 ID가 아닌 안전한 역할명이어야 합니다.");
  }
  if (
    typeof primaryObserver === "string"
    && typeof alternateObserver === "string"
    && primaryObserver === alternateObserver
  ) {
    blockers.push("launch approval 주 관측자와 대체 관측자는 서로 달라야 합니다.");
  }
  if (expectedPrimaryObserver && primaryObserver !== expectedPrimaryObserver) {
    blockers.push("launch approval 주 관측자가 release record 관측 책임자와 다릅니다.");
  }

  return {
    capturedAt: validDateTime(value.capturedAt) ? value.capturedAt : null,
    appSourceCommit,
    workerSourceCommit,
    fixedPricingKrw: {
      monthly: Number.isSafeInteger(value.fixedPricingKrw?.monthly)
        ? value.fixedPricingKrw.monthly
        : null,
      annual: Number.isSafeInteger(value.fixedPricingKrw?.annual)
        ? value.fixedPricingKrw.annual
        : null,
    },
    primaryObserver: validObserverRole(primaryObserver) ? primaryObserver : null,
    alternateObserver: validObserverRole(alternateObserver) ? alternateObserver : null,
    referenceCounts,
  };
}

function exactFileEvidence(root, paths) {
  return paths.map((path) => {
    const evidence = fileEvidence(resolve(root, path), root);
    return evidence ? { path: evidence.path, bytes: evidence.bytes, sha256: evidence.sha256 } : null;
  });
}

function safeHashDirectory(blockers, label, root, options) {
  try {
    return hashDirectory(root, options);
  } catch (error) {
    blockers.push(`${label}를 해시할 수 없습니다: ${error instanceof Error ? error.message : "unknown"}`);
    return null;
  }
}

function validateExpectedEvidenceHash({ blockers, label, expectedHash, evidence }) {
  addMissing(blockers, expectedHash, `${label} expected SHA-256`);
  if (expectedHash && evidence.file && evidence.file.sha256 !== expectedHash) {
    blockers.push(`${label} expected SHA-256이 실제 evidence 파일과 다릅니다.`);
  }
  if (evidence.error) blockers.push(`${label} evidence를 읽을 수 없습니다: ${evidence.error}`);
}

function validatePagesProvenance({
  blockers,
  evidence,
  expectedHash,
  artifactName,
  appGit,
  metadata,
  packageLockSha256,
  dist,
  external,
}) {
  validateExpectedEvidenceHash({
    blockers,
    label: "Pages provenance",
    expectedHash,
    evidence,
  });
  if (!evidence.file) {
    blockers.push("Pages provenance manifest 파일이 없습니다.");
    return null;
  }
  const value = evidence.value;
  if (!value) return null;
  if (value.schemaVersion !== 1 || value.artifactKind !== "hyeni-pages-dist") {
    blockers.push("Pages provenance manifest schema 또는 artifactKind가 올바르지 않습니다.");
  }
  if (!validDateTime(value.generatedAt)) {
    blockers.push("Pages provenance 생성 시각이 유효하지 않습니다.");
  }
  const sourceCommit = normalizeCommit(value.source?.commit);
  if (!sourceCommit || sourceCommit !== appGit.head) {
    blockers.push("Pages provenance source commit이 현재 app commit과 다릅니다.");
  }
  if (sourceCommit && external.appCiSourceCommit && sourceCommit !== external.appCiSourceCommit) {
    blockers.push("Pages provenance source commit이 앱 CI source commit과 다릅니다.");
  }
  if (`${value.ci?.runId ?? ""}` !== `${external.appCiRunId ?? ""}`) {
    blockers.push("Pages provenance CI run ID가 승인한 앱 CI run ID와 다릅니다.");
  }
  addMissing(blockers, artifactName, "Pages CI artifact name");
  if (artifactName && value.ci?.artifactName !== artifactName) {
    blockers.push("Pages provenance artifact name이 승인한 CI artifact와 다릅니다.");
  }
  if (sourceCommit && value.ci?.artifactName !== `hyeni-pages-dist-${sourceCommit}`) {
    blockers.push("Pages provenance artifact name이 source commit 규칙과 다릅니다.");
  }
  if (
    value.app?.packageVersion !== metadata.packageVersion
    || value.app?.minimumSupportedVersion !== metadata.minimumSupportedVersion
    || value.app?.latestVersion !== metadata.latestVersion
  ) {
    blockers.push("Pages provenance 앱 버전 정책이 현재 package/public 버전과 다릅니다.");
  }
  if (value.app?.packageLockSha256 !== packageLockSha256) {
    blockers.push("Pages provenance package-lock SHA-256이 현재 파일과 다릅니다.");
  }
  if (!dist || value.dist?.sha256 !== dist.sha256 || value.dist?.fileCount !== dist.fileCount) {
    blockers.push("Pages provenance dist 해시 또는 파일 수가 현재 배포 dist와 다릅니다.");
  }
  return {
    sourceCommit,
    ciRunId: value.ci?.runId ?? null,
    artifactName: value.ci?.artifactName ?? null,
    distSha256: value.dist?.sha256 ?? null,
    distFileCount: value.dist?.fileCount ?? null,
  };
}

function validateAabEvidence({
  blockers,
  evidence,
  expectedHash,
  evidencePath,
  appGit,
  metadata,
  releaseAab,
  dist,
  distPath,
  external,
  appRoot,
}) {
  validateExpectedEvidenceHash({
    blockers,
    label: "release AAB",
    expectedHash,
    evidence,
  });
  if (!evidence.file) {
    blockers.push("release AAB machine evidence 파일이 없습니다.");
    return { summary: null, manifestDump: null };
  }
  const value = evidence.value;
  if (!value) return { summary: null, manifestDump: null };
  if (value.schemaVersion !== 4 || value.artifactKind !== "hyeni-android-aab") {
    blockers.push("release AAB evidence schema 또는 artifactKind가 올바르지 않습니다.");
  }
  if (!validDateTime(value.generatedAt)) {
    blockers.push("release AAB evidence 생성 시각이 유효하지 않습니다.");
  }
  if (value.buildType !== "release") blockers.push("release AAB evidence의 buildType이 release가 아닙니다.");
  const sourceCommit = normalizeCommit(value.sourceCommit);
  const embeddedSourceCommit = normalizeCommit(value.manifest?.sourceCommit);
  if (!sourceCommit || sourceCommit !== appGit.head) {
    blockers.push("release AAB evidence source commit이 현재 app commit과 다릅니다.");
  }
  if (!embeddedSourceCommit || embeddedSourceCommit !== sourceCommit) {
    blockers.push("release AAB manifest 내부 source commit이 evidence source와 다릅니다.");
  }
  if (external.releaseAabSourceCommit && sourceCommit !== external.releaseAabSourceCommit) {
    blockers.push("release AAB machine evidence source가 승인한 AAB source commit과 다릅니다.");
  }
  if (
    value.app?.packageName !== metadata.applicationId
    || value.app?.packageVersion !== metadata.packageVersion
    || value.app?.minimumSupportedVersion !== metadata.minimumSupportedVersion
    || value.app?.latestVersion !== metadata.latestVersion
  ) {
    blockers.push("release AAB evidence의 package 또는 버전 정책이 현재 코드와 다릅니다.");
  }
  if (
    value.manifest?.versionName !== metadata.packageVersion
    || value.manifest?.versionCode !== metadata.versionCode
  ) {
    blockers.push("bundletool versionName/versionCode가 현재 package/Gradle과 다릅니다.");
  }
  if (value.manifest?.debuggable !== false) {
    blockers.push("release AAB manifest가 non-debuggable로 확인되지 않았습니다.");
  }
  const expectedPermissionNames = expectedReleasePermissionNames(metadata.applicationId);
  const manifestPolicy = value.manifest?.policy;
  if (
    manifestPolicy?.policyVersion !== ANDROID_MANIFEST_POLICY_VERSION
    || manifestPolicy?.exactApprovedPermissions !== true
    || manifestPolicy?.permissionCount !== expectedPermissionNames.length
    || JSON.stringify(manifestPolicy?.permissionNames) !== JSON.stringify(expectedPermissionNames)
    || manifestPolicy?.monitoringTool !== ANDROID_MONITORING_TOOL_VALUE
    || manifestPolicy?.legacyStorageMaxSdkVersion !== 28
  ) {
    blockers.push("release AAB manifest의 최소 권한·자녀 모니터링 정책 증거가 올바르지 않습니다.");
  }
  if (
    !releaseAab
    || value.aab?.fileName !== basename(releaseAab.path)
    || value.aab?.sha256 !== releaseAab.sha256
    || value.aab?.bytes !== releaseAab.bytes
    || value.aab?.mtime !== releaseAab.mtime
  ) {
    blockers.push("release AAB evidence의 파일명·해시·크기·mtime이 실제 AAB와 다릅니다.");
  }
  const embeddedWebAssets = value.webAssets;
  const sourceDistSha256 = normalizeSha256(embeddedWebAssets?.sourceDist?.sha256);
  const androidSourceProjectionSha256 = normalizeSha256(
    embeddedWebAssets?.androidSourceProjection?.sha256,
  );
  const capacitorPublicSha256 = normalizeSha256(embeddedWebAssets?.capacitorPublic?.sha256);
  const embeddedPublicSha256 = normalizeSha256(embeddedWebAssets?.embeddedPublic?.sha256);
  const embeddedDistProjectionSha256 = normalizeSha256(
    embeddedWebAssets?.embeddedDistProjection?.sha256,
  );
  const sourceDistFileCount = embeddedWebAssets?.sourceDist?.fileCount;
  const androidSourceProjectionFileCount = embeddedWebAssets?.androidSourceProjection?.fileCount;
  const capacitorPublicFileCount = embeddedWebAssets?.capacitorPublic?.fileCount;
  const embeddedPublicFileCount = embeddedWebAssets?.embeddedPublic?.fileCount;
  const embeddedDistProjectionFileCount = embeddedWebAssets?.embeddedDistProjection?.fileCount;
  const generatedFiles = embeddedWebAssets?.capacitorGeneratedFiles;
  const expectedGeneratedFiles = [...CAPACITOR_GENERATED_PUBLIC_FILES]
    .sort((left, right) => left.localeCompare(right, "en"));
  const normalizedGeneratedFiles = Array.isArray(generatedFiles)
    ? generatedFiles.map((file) => ({
      path: typeof file?.path === "string" ? file.path : null,
      bytes: file?.bytes,
      sha256: normalizeSha256(file?.sha256),
    })).sort((left, right) => String(left.path).localeCompare(String(right.path), "en"))
    : null;
  const generatedFilesValid = normalizedGeneratedFiles !== null
    && normalizedGeneratedFiles.length === expectedGeneratedFiles.length
    && normalizedGeneratedFiles.every((file, index) => (
      file.path === expectedGeneratedFiles[index]
      && file.bytes === 0
      && file.sha256 === EMPTY_FILE_SHA256
    ));
  const excludedFiles = embeddedWebAssets?.androidPackagingExcludedFiles;
  const expectedExcludedFiles = [...ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES]
    .sort((left, right) => left.localeCompare(right, "en"));
  const normalizedExcludedFiles = Array.isArray(excludedFiles)
    ? excludedFiles.map((file) => ({
      path: typeof file?.path === "string" ? file.path : null,
      bytes: file?.bytes,
      sha256: normalizeSha256(file?.sha256),
    })).sort((left, right) => String(left.path).localeCompare(String(right.path), "en"))
    : null;
  const excludedFilesValid = normalizedExcludedFiles !== null
    && normalizedExcludedFiles.length === expectedExcludedFiles.length
    && normalizedExcludedFiles.every((file, index) => (
      file.path === expectedExcludedFiles[index]
      && Number.isSafeInteger(file.bytes)
      && file.bytes > 0
      && Boolean(file.sha256)
    ));
  const capacitorPublicRoot = resolve(
    appRoot,
    "android",
    "app",
    "src",
    "main",
    "assets",
    "public",
  );
  const currentAndroidSourceProjection = distPath
    ? safeHashDirectory(blockers, "현재 Android 패키징용 dist 투영", distPath, {
      excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    })
    : null;
  const currentCapacitorPublic = safeHashDirectory(
    blockers,
    "현재 Android Capacitor public",
    capacitorPublicRoot,
  );
  const currentCapacitorProjection = safeHashDirectory(
    blockers,
    "현재 Android Capacitor dist 투영",
    capacitorPublicRoot,
    {
    excludeRelativePaths: CAPACITOR_GENERATED_PUBLIC_FILES,
    },
  );
  const expectedEmbeddedPublic = distPath && generatedFilesValid
    ? safeHashDirectory(blockers, "현재 dist 기반 embedded public 기대 투영", distPath, {
      excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
      additionalFiles: normalizedGeneratedFiles,
    })
    : null;
  const currentGeneratedFiles = exactFileEvidence(
    capacitorPublicRoot,
    CAPACITOR_GENERATED_PUBLIC_FILES,
  ).sort((left, right) => String(left?.path).localeCompare(String(right?.path), "en"));
  const currentDistExcludedFiles = distPath
    ? exactFileEvidence(distPath, ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES)
      .sort((left, right) => String(left?.path).localeCompare(String(right?.path), "en"))
    : [];
  const currentCapacitorExcludedFiles = exactFileEvidence(
    capacitorPublicRoot,
    ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
  ).sort((left, right) => String(left?.path).localeCompare(String(right?.path), "en"));
  let generatedNameCollisionFree = false;
  if (distPath) {
    try {
      assertNoCapacitorGeneratedFileCollisions(distPath);
      generatedNameCollisionFree = true;
    } catch (error) {
      blockers.push(
        `release dist의 Capacitor 예약 파일 충돌을 확인했습니다: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  if (
    embeddedWebAssets?.matched !== true
    || embeddedWebAssets?.projectionVersion !== CAPACITOR_PUBLIC_PROJECTION_VERSION
    || !sourceDistSha256
    || !androidSourceProjectionSha256
    || !capacitorPublicSha256
    || !embeddedPublicSha256
    || !embeddedDistProjectionSha256
    || !Number.isSafeInteger(sourceDistFileCount)
    || sourceDistFileCount < 1
    || !Number.isSafeInteger(androidSourceProjectionFileCount)
    || androidSourceProjectionFileCount < 1
    || !Number.isSafeInteger(capacitorPublicFileCount)
    || capacitorPublicFileCount < 1
    || !Number.isSafeInteger(embeddedPublicFileCount)
    || embeddedPublicFileCount < 1
    || !Number.isSafeInteger(embeddedDistProjectionFileCount)
    || embeddedDistProjectionFileCount < 1
    || androidSourceProjectionSha256 !== embeddedDistProjectionSha256
    || androidSourceProjectionFileCount !== embeddedDistProjectionFileCount
    || sourceDistFileCount !== androidSourceProjectionFileCount
      + ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES.length
    || capacitorPublicFileCount !== sourceDistFileCount + CAPACITOR_GENERATED_PUBLIC_FILES.length
    || embeddedPublicFileCount !== androidSourceProjectionFileCount
      + CAPACITOR_GENERATED_PUBLIC_FILES.length
    || !expectedEmbeddedPublic
    || embeddedPublicSha256 !== expectedEmbeddedPublic.sha256
    || embeddedPublicFileCount !== expectedEmbeddedPublic.fileCount
    || !generatedFilesValid
    || !excludedFilesValid
    || !generatedNameCollisionFree
    || !dist
    || sourceDistSha256 !== dist.sha256
    || sourceDistFileCount !== dist.fileCount
    || !currentAndroidSourceProjection
    || androidSourceProjectionSha256 !== currentAndroidSourceProjection.sha256
    || androidSourceProjectionFileCount !== currentAndroidSourceProjection.fileCount
    || !currentCapacitorPublic
    || capacitorPublicSha256 !== currentCapacitorPublic.sha256
    || capacitorPublicFileCount !== currentCapacitorPublic.fileCount
    || !currentCapacitorProjection
    || currentCapacitorProjection.sha256 !== sourceDistSha256
    || currentCapacitorProjection.fileCount !== sourceDistFileCount
    || JSON.stringify(normalizedGeneratedFiles) !== JSON.stringify(currentGeneratedFiles)
    || JSON.stringify(normalizedExcludedFiles) !== JSON.stringify(currentDistExcludedFiles)
    || JSON.stringify(normalizedExcludedFiles) !== JSON.stringify(currentCapacitorExcludedFiles)
  ) {
    blockers.push("release AAB 내부 web assets가 Pages provenance dist와 일치하지 않습니다.");
  }
  const archiveSafety = value.archiveSafety;
  if (
    archiveSafety?.allEntriesSafe !== true
    || archiveSafety?.noDuplicateOrPortableNameCollisions !== true
    || archiveSafety?.noFeatureModuleWebAssets !== true
    || !Number.isSafeInteger(archiveSafety?.aabEntryCount)
    || archiveSafety.aabEntryCount < 1
    || !Number.isSafeInteger(archiveSafety?.apksEntryCount)
    || archiveSafety.apksEntryCount < 1
    || !Number.isSafeInteger(archiveSafety?.universalApkEntryCount)
    || archiveSafety.universalApkEntryCount < 1
  ) {
    blockers.push("release AAB archive entry 안전 검증 증거가 올바르지 않습니다.");
  }
  if (
    value.integrity?.aabStableDuringVerification !== true
    || value.integrity?.sourceDistStableDuringVerification !== true
    || value.integrity?.androidSourceProjectionStableDuringVerification !== true
    || value.integrity?.capacitorPublicStableDuringVerification !== true
  ) {
    blockers.push("release AAB 검증 입력의 시작·종료 무결성 증거가 올바르지 않습니다.");
  }
  if (
    validDateTime(value.generatedAt)
    && validDateTime(value.aab?.mtime)
    && Date.parse(value.generatedAt) + EVIDENCE_FUTURE_SKEW_MS < Date.parse(value.aab.mtime)
  ) {
    blockers.push("release AAB evidence 생성 시각이 AAB mtime보다 빠릅니다.");
  }
  if (
    value.signature?.jarsignerVerified !== true
    || !normalizeSha256(value.signature?.certificateSha256)
    || value.signature?.certificateSha256 !== external.releaseUploadCertificateSha256
    || value.signature?.expectedCertificateSha256 !== external.releaseUploadCertificateSha256
    || value.signature?.expectedCertificateMatched !== true
    || !normalizeSha256(value.signature?.jarsignerOutputSha256)
    || !normalizeSha256(value.signature?.certificateOutputSha256)
  ) {
    blockers.push("release AAB의 기계 서명 검증 또는 upload certificate 일치 증거가 올바르지 않습니다.");
  }
  const alignment = value.alignment16Kb;
  const elfLibraries = alignment?.elfLibraries;
  if (
    alignment?.bundleConfigPageAlignment16Kb !== true
    || alignment?.universalApkZipAligned16Kb !== true
    || alignment?.allElfLoadSegmentsAtLeast16384 !== true
    || !Number.isSafeInteger(alignment?.nativeLibraryCount)
    || alignment.nativeLibraryCount < 1
    || !Number.isSafeInteger(alignment?.elfLoadSegmentCount)
    || alignment.elfLoadSegmentCount < alignment.nativeLibraryCount
    || !Number.isSafeInteger(alignment?.minimumElfLoadAlignment)
    || alignment.minimumElfLoadAlignment < 16_384
    || !normalizeSha256(alignment?.bundleConfigOutputSha256)
    || !normalizeSha256(alignment?.zipalignOutputSha256)
    || !normalizeSha256(alignment?.elfSummarySha256)
    || !Array.isArray(elfLibraries)
    || elfLibraries.length !== alignment.nativeLibraryCount
    || elfLibraries.reduce((sum, library) => sum + (library?.loadSegmentCount ?? 0), 0)
      !== alignment.elfLoadSegmentCount
    || sha256(`${JSON.stringify(elfLibraries)}\n`) !== alignment.elfSummarySha256
    || elfLibraries.some((library) => (
      typeof library?.path !== "string"
      || !library.path
      || !Number.isSafeInteger(library.loadSegmentCount)
      || library.loadSegmentCount < 1
      || !Number.isSafeInteger(library.minimumLoadAlignment)
      || library.minimumLoadAlignment < 16_384
      || !normalizeSha256(library.sha256)
    ))
  ) {
    blockers.push("release AAB의 bundle config·ZIP·전체 ELF 16KB 기계 검증 증거가 올바르지 않습니다.");
  }
  const requiredToolNames = ["bundletool", "jarsigner", "keytool", "zipalign", "readelf"];
  if (
    !requiredToolNames.every((name) => normalizeSha256(value.tools?.[name]?.sha256))
    || value.tools?.bundletool?.version !== APPROVED_BUNDLETOOL_VERSION
    || value.tools?.bundletool?.sha256 !== APPROVED_BUNDLETOOL_SHA256
    || typeof value.tools?.java?.versionOutput !== "string"
    || !value.tools.java.versionOutput
    || typeof value.tools?.readelf?.versionOutput !== "string"
    || !value.tools.readelf.versionOutput
  ) {
    blockers.push("AAB 검증 도구 버전 또는 실행 파일 SHA-256 증거가 올바르지 않습니다.");
  }

  const dumpFileName = value.verificationLog?.fileName;
  let manifestDump = null;
  if (
    typeof dumpFileName !== "string"
    || !dumpFileName
    || basename(dumpFileName) !== dumpFileName
    || !evidencePath
  ) {
    blockers.push("AAB machine verification log 파일명이 안전한 상대 파일명이 아닙니다.");
  } else {
    const dumpPath = resolve(dirname(evidencePath), dumpFileName);
    manifestDump = fileEvidence(dumpPath, appRoot);
    if (!manifestDump) blockers.push("AAB machine verification 원본 로그 파일이 없습니다.");
    else if (
      value.verificationLog.sha256 !== manifestDump.sha256
      || value.verificationLog.bytes !== manifestDump.bytes
    ) {
      blockers.push("AAB machine verification 로그 해시 또는 크기가 evidence와 다릅니다.");
    }
  }

  return {
    summary: {
      sourceCommit,
      embeddedSourceCommit,
      packageName: value.app?.packageName ?? null,
      versionName: value.manifest?.versionName ?? null,
      versionCode: value.manifest?.versionCode ?? null,
      manifestPermissionCount: Number.isSafeInteger(manifestPolicy?.permissionCount)
        ? manifestPolicy.permissionCount
        : null,
      monitoringTool: manifestPolicy?.monitoringTool ?? null,
      aabSha256: value.aab?.sha256 ?? null,
      signerCertificateSha256: value.signature?.certificateSha256 ?? null,
      bundletoolVersion: value.tools?.bundletool?.version ?? null,
      minimumElfLoadAlignment: value.alignment16Kb?.minimumElfLoadAlignment ?? null,
      sourceDistSha256,
      androidSourceProjectionSha256,
      capacitorPublicSha256,
      embeddedPublicSha256,
      embeddedDistProjectionSha256,
      embeddedDistProjectionFileCount: Number.isSafeInteger(embeddedDistProjectionFileCount)
        ? embeddedDistProjectionFileCount
        : null,
      capacitorGeneratedFileCount: generatedFilesValid
        ? CAPACITOR_GENERATED_PUBLIC_FILES.length
        : null,
    },
    manifestDump,
  };
}

function validateClientInventory({
  blockers,
  evidence,
  expectedHash,
  appGit,
  workerGit,
  metadata,
  recordGeneratedAt,
}) {
  validateExpectedEvidenceHash({
    blockers,
    label: "기존 설치·Play inventory",
    expectedHash,
    evidence,
  });
  if (!evidence.file) {
    blockers.push("기존 설치·Play inventory evidence 파일이 없습니다.");
    return null;
  }
  const value = evidence.value;
  if (!value) return null;
  if (value.schemaVersion !== 1 || value.artifactKind !== "hyeni-client-release-inventory") {
    blockers.push("기존 설치·Play inventory schema 또는 artifactKind가 올바르지 않습니다.");
  }
  const appSourceCommit = normalizeCommit(value.appSourceCommit);
  const workerSourceCommit = normalizeCommit(value.workerSourceCommit);
  if (!appSourceCommit || appSourceCommit !== appGit.head) {
    blockers.push("inventory app source commit이 현재 app commit과 다릅니다.");
  }
  if (!workerSourceCommit || workerSourceCommit !== workerGit.head) {
    blockers.push("inventory Worker source commit이 현재 Worker commit과 다릅니다.");
  }
  validateFreshDateTime({
    blockers,
    label: "기존 설치·Play inventory capturedAt",
    value: value.capturedAt,
    recordGeneratedAt,
    maxAgeMs: INVENTORY_MAX_AGE_MS,
  });
  if (value.appId !== metadata.applicationId) blockers.push("inventory appId가 Android applicationId와 다릅니다.");

  const tracks = value.playConsole?.tracksReviewed;
  if (
    !Array.isArray(tracks)
    || tracks.length !== REQUIRED_PLAY_TRACKS.length
    || !REQUIRED_PLAY_TRACKS.every((track) => tracks.includes(track))
  ) {
    blockers.push("Play internal/closed/open/production 전체 트랙 inventory가 없습니다.");
  }
  const maximumPreviouslyUsedVersionCode = value.playConsole?.maximumPreviouslyUsedVersionCode;
  if (!Number.isSafeInteger(maximumPreviouslyUsedVersionCode) || maximumPreviouslyUsedVersionCode < 0) {
    blockers.push("Play의 기존 최대 versionCode attestation이 올바르지 않습니다.");
  } else if (metadata.versionCode <= maximumPreviouslyUsedVersionCode) {
    blockers.push("후보 versionCode가 Play에서 이미 사용된 최대 versionCode보다 크지 않습니다.");
  }
  if (!nonEmptyStrings(value.playConsole?.evidenceReferences)) {
    blockers.push("Play 트랙·최대 versionCode 외부 증거 참조가 없습니다.");
  }

  const installCount = value.existingPublicInstalls?.activeInstallCount;
  if (value.existingPublicInstalls?.inventoryComplete !== true) {
    blockers.push("기존 공개 설치 inventory가 완료 상태가 아닙니다.");
  }
  if (!Number.isSafeInteger(installCount) || installCount < 0) {
    blockers.push("기존 공개 설치 수가 유효하지 않습니다.");
  }
  if (!nonEmptyStrings(value.existingPublicInstalls?.evidenceReferences)) {
    blockers.push("기존 공개 설치 inventory 외부 증거 참조가 없습니다.");
  }

  const mode = value.cutover?.mode;
  if (mode === "zero_public_installs") {
    if (installCount !== 0) blockers.push("zero_public_installs 모드인데 기존 공개 설치 수가 0이 아닙니다.");
  } else if (mode === "compatibility_cutover_approved") {
    if (!Number.isSafeInteger(installCount) || installCount < 1) {
      blockers.push("compatibility cutover는 기존 공개 설치가 1건 이상이어야 합니다.");
    }
    const approval = value.cutover?.approval;
    if (
      approval?.approved !== true
      || typeof approval.approvedBy !== "string"
      || !approval.approvedBy.trim()
      || !validDateTime(approval.approvedAt)
      || typeof approval.evidenceReference !== "string"
      || !approval.evidenceReference.trim()
    ) {
      blockers.push("기존 설치 compatibility cutover 승인 evidence가 완전하지 않습니다.");
    }
    const availability = value.playConsole?.candidateAvailability;
    if (
      availability?.availableToExistingInstalls !== true
      || availability.versionCode !== metadata.versionCode
      || availability.versionName !== metadata.packageVersion
      || !validDateTime(availability.verifiedAt)
      || !nonEmptyStrings(availability.evidenceReferences)
    ) {
      blockers.push("기존 설치 대상 Play 후보 가용성 evidence가 없습니다.");
    }
    if (
      validDateTime(availability?.verifiedAt)
      && validDateTime(value.capturedAt)
      && Date.parse(availability.verifiedAt) > Date.parse(value.capturedAt) + EVIDENCE_FUTURE_SKEW_MS
    ) {
      blockers.push("Play 후보 가용성 확인 시각이 inventory capturedAt보다 미래입니다.");
    }
  } else {
    blockers.push("cutover mode는 zero_public_installs 또는 compatibility_cutover_approved여야 합니다.");
  }

  return {
    mode: mode ?? null,
    activePublicInstallCount: Number.isSafeInteger(installCount) ? installCount : null,
    maximumPreviouslyUsedVersionCode: Number.isSafeInteger(maximumPreviouslyUsedVersionCode)
      ? maximumPreviouslyUsedVersionCode
      : null,
    tracksReviewed: Array.isArray(tracks) ? tracks : null,
    playCandidateAvailableBeforeMinimumVersionPolicy:
      value.playConsole?.candidateAvailability?.availableToExistingInstalls === true,
  };
}

export function buildReleaseRecord({
  appRoot = resolve(import.meta.dirname, ".."),
  workerRoot = appRoot, // worker/ 정본이 앱 저장소 안으로 이관됨
  env = process.env,
  generatedAt = new Date().toISOString(),
  jsonEvidenceIo = {},
} = {}) {
  const blockers = [];
  const appGit = readGitState(appRoot);
  const workerGit = readGitState(workerRoot);
  let workerD1Config = null;
  try {
    workerD1Config = readWorkerD1Config(workerRoot);
  } catch (error) {
    blockers.push(`Worker D1 설정을 읽을 수 없습니다: ${error instanceof Error ? error.message : "unknown"}`);
  }
  let metadata = {
    applicationId: null,
    versionCode: null,
    packageVersion: null,
    minimumSupportedVersion: null,
    latestVersion: null,
    gradleUsesPackageVersion: false,
  };
  try {
    metadata = readAppReleaseMetadata(appRoot);
  } catch (error) {
    blockers.push(`앱 버전 메타데이터를 읽을 수 없습니다: ${error instanceof Error ? error.message : "unknown"}`);
  }

  const distPath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_PAGES_DIST_PATH") ?? "dist",
  );
  let dist = null;
  try {
    dist = hashDirectory(distPath);
  } catch (error) {
    blockers.push(`Pages dist를 해시할 수 없습니다: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const debugApk = fileEvidence(
    resolve(appRoot, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    appRoot,
  );
  const releaseAabPath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_AAB_PATH")
      ?? "android/app/build/outputs/bundle/release/app-release.aab",
  );
  const releaseAab = fileEvidence(releaseAabPath, appRoot);
  const packageLockSha256 = fileEvidence(resolve(appRoot, "package-lock.json"), appRoot)?.sha256 ?? null;
  const d1ReadOnlyPreflightSql = fileEvidence(
    resolve(workerRoot, "worker", "ops", "release-d1-readonly-preflight.sql"),
    workerRoot,
  );
  const credentialFilePresent = existsSync(
    resolve(appRoot, "android", "keystore", "hyeni-upload-credentials.txt"),
  );

  const pagesProvenancePath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_PAGES_PROVENANCE_PATH"),
  );
  const aabEvidencePath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_AAB_EVIDENCE_PATH"),
  );
  const inventoryPath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_CLIENT_INVENTORY_PATH"),
  );
  const launchApprovalPath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_LAUNCH_APPROVAL_PATH"),
  );
  const d1BookmarkEvidencePath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_PATH"),
  );
  const pagesProvenanceEvidence = readJsonEvidence(pagesProvenancePath, appRoot, jsonEvidenceIo);
  const aabMachineEvidence = readJsonEvidence(aabEvidencePath, appRoot, jsonEvidenceIo);
  const clientInventoryEvidence = readJsonEvidence(inventoryPath, appRoot, jsonEvidenceIo);
  const launchApprovalEvidence = readJsonEvidence(launchApprovalPath, appRoot, jsonEvidenceIo);
  const d1BookmarkEvidence = readJsonEvidence(d1BookmarkEvidencePath, appRoot, jsonEvidenceIo);

  const knownGoodPagesArchivePath = resolveInputPath(
    appRoot,
    envText(env, "HYENI_KNOWN_GOOD_PAGES_ARCHIVE_PATH"),
  );
  const knownGoodPagesArchive = knownGoodPagesArchivePath
    ? fileEvidence(knownGoodPagesArchivePath, appRoot)
    : null;
  const firstHourObservationOwnerInput = envText(env, "HYENI_RELEASE_OBSERVATION_OWNER");

  const external = {
    appCiRunId: envText(env, "HYENI_RELEASE_APP_CI_RUN_ID"),
    appCiSourceCommit: normalizeCommit(envText(env, "HYENI_RELEASE_APP_CI_SOURCE_SHA")),
    workerCiRunId: envText(env, "HYENI_RELEASE_WORKER_CI_RUN_ID"),
    workerCiSourceCommit: normalizeCommit(envText(env, "HYENI_RELEASE_WORKER_CI_SOURCE_SHA")),
    pagesArtifactName: envText(env, "HYENI_RELEASE_PAGES_ARTIFACT_NAME"),
    pagesProvenanceExpectedSha256: normalizeSha256(
      envText(env, "HYENI_RELEASE_PAGES_PROVENANCE_SHA256"),
    ),
    releaseAabSourceCommit: normalizeCommit(envText(env, "HYENI_RELEASE_AAB_SOURCE_SHA")),
    releaseAabEvidenceExpectedSha256: normalizeSha256(
      envText(env, "HYENI_RELEASE_AAB_EVIDENCE_SHA256"),
    ),
    releaseUploadCertificateSha256: normalizeSha256(
      envText(env, "HYENI_RELEASE_UPLOAD_CERTIFICATE_SHA256"),
    ),
    clientInventoryExpectedSha256: normalizeSha256(
      envText(env, "HYENI_RELEASE_CLIENT_INVENTORY_SHA256"),
    ),
    launchApprovalExpectedSha256: normalizeSha256(
      envText(env, "HYENI_RELEASE_LAUNCH_APPROVAL_SHA256"),
    ),
    d1BookmarkEvidenceExpectedSha256: normalizeSha256(
      envText(env, "HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256"),
    ),
    pagesDeploymentId: envText(env, "HYENI_RELEASE_PAGES_DEPLOYMENT_ID"),
    pagesSourceCommit: normalizeCommit(envText(env, "HYENI_RELEASE_PAGES_SOURCE_SHA")),
    workerVersionId: envText(env, "HYENI_RELEASE_WORKER_VERSION_ID"),
    workerSourceCommit: normalizeCommit(envText(env, "HYENI_RELEASE_WORKER_SOURCE_SHA")),
    knownGoodPagesDistSha256: normalizeSha256(envText(env, "HYENI_KNOWN_GOOD_PAGES_DIST_SHA256")),
    knownGoodPagesArchiveSha256: normalizeSha256(
      envText(env, "HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256"),
    ),
    knownGoodPagesArchive,
    knownGoodWorkerVersionId: envText(env, "HYENI_KNOWN_GOOD_WORKER_VERSION_ID"),
    firstHourObservationOwner: validObserverRole(firstHourObservationOwnerInput)
      ? firstHourObservationOwnerInput
      : null,
  };
  let knownGoodPagesArchiveInspection = null;

  if (!appGit.clean) blockers.push("앱 worktree가 clean 상태가 아닙니다.");
  if (!workerGit.clean) blockers.push("Worker worktree가 clean 상태가 아닙니다.");
  addMissing(blockers, appGit.head, "앱 commit SHA");
  addMissing(blockers, workerGit.head, "Worker commit SHA");
  addMissing(blockers, dist, "Pages dist");
  addMissing(blockers, releaseAab, "최신 서명 release AAB");
  if (!metadata.applicationId || !metadata.versionCode || !metadata.packageVersion) {
    blockers.push("package/public/Gradle 출시 버전 정본이 완전하지 않습니다.");
  }
  if (!isReleaseVersionPolicySafe(metadata) || !metadata.gradleUsesPackageVersion) {
    blockers.push("package/public/Gradle versionName 정책이 일치하지 않습니다.");
  }
  if (!external.releaseAabSourceCommit) {
    blockers.push("release AAB의 원본 app commit SHA 증거가 없습니다.");
  } else if (external.releaseAabSourceCommit !== appGit.head) {
    blockers.push("release AAB 원본 commit이 현재 app commit과 다릅니다.");
  }
  addMissing(blockers, external.releaseUploadCertificateSha256, "승인된 upload certificate SHA-256");
  if (credentialFilePresent) blockers.push("평문 서명 자격정보 파일이 남아 있습니다.");

  addMissing(blockers, external.appCiRunId, "앱 green CI run ID");
  addMissing(blockers, external.appCiSourceCommit, "앱 CI source commit");
  if (external.appCiSourceCommit && external.appCiSourceCommit !== appGit.head) {
    blockers.push("앱 CI source commit이 현재 app commit과 다릅니다.");
  }
  addMissing(blockers, external.workerCiRunId, "Worker green CI run ID");
  addMissing(blockers, external.workerCiSourceCommit, "Worker CI source commit");
  if (external.workerCiSourceCommit && external.workerCiSourceCommit !== workerGit.head) {
    blockers.push("Worker CI source commit이 현재 Worker commit과 다릅니다.");
  }

  const pagesProvenance = validatePagesProvenance({
    blockers,
    evidence: pagesProvenanceEvidence,
    expectedHash: external.pagesProvenanceExpectedSha256,
    artifactName: external.pagesArtifactName,
    appGit,
    metadata,
    packageLockSha256,
    dist,
    external,
  });
  const { summary: aabEvidence, manifestDump: aabManifestDump } = validateAabEvidence({
    blockers,
    evidence: aabMachineEvidence,
    expectedHash: external.releaseAabEvidenceExpectedSha256,
    evidencePath: aabEvidencePath,
    appGit,
    metadata,
    releaseAab,
    dist,
    distPath,
    external,
    appRoot,
  });
  const clientInventory = validateClientInventory({
    blockers,
    evidence: clientInventoryEvidence,
    expectedHash: external.clientInventoryExpectedSha256,
    appGit,
    workerGit,
    metadata,
    recordGeneratedAt: generatedAt,
  });
  const launchApproval = validateLaunchApprovalEvidence({
    blockers,
    evidence: launchApprovalEvidence,
    expectedHash: external.launchApprovalExpectedSha256,
    appGit,
    workerGit,
    recordGeneratedAt: generatedAt,
    expectedPrimaryObserver: external.firstHourObservationOwner,
  });
  const d1TimeTravelBookmark = validateD1BookmarkEvidence({
    blockers,
    evidence: d1BookmarkEvidence,
    expectedHash: external.d1BookmarkEvidenceExpectedSha256,
    appGit,
    workerGit,
    workerD1Config,
    preflightSql: d1ReadOnlyPreflightSql,
    appRoot,
    jsonEvidenceIo,
    recordGeneratedAt: generatedAt,
  });
  if (envText(env, "HYENI_RELEASE_D1_BOOKMARK")) {
    blockers.push("HYENI_RELEASE_D1_BOOKMARK 원문 문자열은 증거로 인정하지 않습니다. strict JSON evidence를 사용해야 합니다.");
  }

  addMissing(blockers, external.pagesDeploymentId, "Pages deployment ID");
  addMissing(blockers, external.pagesSourceCommit, "Pages deployment source commit");
  if (external.pagesSourceCommit && external.pagesSourceCommit !== appGit.head) {
    blockers.push("Pages deployment source commit이 현재 app commit과 다릅니다.");
  }
  addMissing(blockers, external.workerVersionId, "Worker version ID");
  addMissing(blockers, external.workerSourceCommit, "Worker version source commit");
  if (external.workerSourceCommit && external.workerSourceCommit !== workerGit.head) {
    blockers.push("Worker version source commit이 현재 Worker commit과 다릅니다.");
  }
  addMissing(blockers, external.knownGoodPagesDistSha256, "known-good Pages dist SHA-256");
  addMissing(blockers, external.knownGoodPagesArchive, "known-good Pages dist archive");
  addMissing(blockers, external.knownGoodPagesArchiveSha256, "known-good Pages archive SHA-256");
  if (
    external.knownGoodPagesArchive
    && external.knownGoodPagesArchiveSha256
    && external.knownGoodPagesArchive.sha256 !== external.knownGoodPagesArchiveSha256
  ) {
    blockers.push("known-good Pages archive SHA-256이 실제 파일과 다릅니다.");
  }
  if (
    knownGoodPagesArchivePath
    && external.knownGoodPagesArchive
    && external.knownGoodPagesArchiveSha256
    && external.knownGoodPagesDistSha256
  ) {
    try {
      knownGoodPagesArchiveInspection = inspectKnownGoodPagesArchive(
        knownGoodPagesArchivePath,
        {
          expectedArchiveSha256: external.knownGoodPagesArchiveSha256,
          expectedTreeSha256: external.knownGoodPagesDistSha256,
        },
      );
      if (
        knownGoodPagesArchiveInspection.archiveSha256
        !== external.knownGoodPagesArchive.sha256
      ) {
        blockers.push("known-good Pages archive가 release record 생성 중 변경되었습니다.");
        knownGoodPagesArchiveInspection = null;
      }
    } catch (error) {
      blockers.push(
        error instanceof Error
          ? error.message.split(/\r?\n/, 1)[0]
          : "known-good Pages ZIP 검증 실패: 알 수 없는 오류입니다.",
      );
    }
  }
  addMissing(blockers, external.knownGoodWorkerVersionId, "known-good Worker version ID");
  addMissing(blockers, external.firstHourObservationOwner, "배포 후 첫 60분 관측 책임자");
  if (firstHourObservationOwnerInput && !external.firstHourObservationOwner) {
    blockers.push("첫 60분 관측 책임자는 사용자 ID가 아닌 안전한 역할명이어야 합니다.");
  }

  return {
    schemaVersion: 4,
    generatedAt,
    assessment: {
      verdict: blockers.length === 0 ? "READY_FOR_HUMAN_GO_REVIEW" : "HOLD",
      humanApprovalRequired: true,
      blockers,
    },
    fixedPricingKrw: { monthly: 4900, annual: 39000 },
    releaseMetadata: metadata,
    app: {
      git: appGit,
      packageLockSha256,
      dist: dist ? {
        path: relative(appRoot, distPath).replaceAll("\\", "/"),
        ...dist,
      } : null,
      debugApk,
      releaseAab,
      plaintextSigningCredentialFilePresent: credentialFilePresent,
    },
    worker: {
      git: workerGit,
      packageLockSha256: fileEvidence(resolve(workerRoot, "package-lock.json"), workerRoot)?.sha256 ?? null,
    },
    machineEvidence: {
      pagesProvenance: {
        file: pagesProvenanceEvidence.file,
        summary: pagesProvenance,
      },
      releaseAab: {
        file: aabMachineEvidence.file,
        manifestDump: aabManifestDump,
        summary: aabEvidence,
      },
      clientInventory: {
        file: clientInventoryEvidence.file,
        summary: clientInventory,
      },
      launchApproval: {
        file: launchApprovalEvidence.file,
        summary: launchApproval,
      },
      d1TimeTravelBookmark: {
        file: d1BookmarkEvidence.file,
        summary: d1TimeTravelBookmark,
      },
      knownGoodPagesArchive: {
        file: external.knownGoodPagesArchive,
        summary: knownGoodPagesArchiveInspection,
      },
    },
    externalEvidence: external,
  };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} 값이 필요합니다.`);
  return value;
}

function run() {
  const appRoot = resolve(argument("app-root") ?? resolve(import.meta.dirname, ".."));
  const workerRoot = resolve(argument("worker-root") ?? appRoot);
  const record = buildReleaseRecord({ appRoot, workerRoot });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  const output = argument("out");
  if (output) {
    const outputPath = resolveInputPath(appRoot, output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, json, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${outputPath}\n`);
  } else {
    process.stdout.write(json);
  }
  if (record.assessment.verdict === "HOLD") process.exitCode = 2;
}

const isDirect = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) run();
