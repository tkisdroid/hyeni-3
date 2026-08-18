import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  buildReleaseRecord,
  readJsonEvidence,
} from "../scripts/create-release-record.mjs";
import { buildPagesProvenance } from "../scripts/create-pages-provenance.mjs";
import {
  APPROVED_BUNDLETOOL_SHA256,
  APPROVED_BUNDLETOOL_VERSION,
  ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
  CAPACITOR_GENERATED_PUBLIC_FILES,
  CAPACITOR_PUBLIC_PROJECTION_VERSION,
  EMPTY_FILE_SHA256,
  assertArchiveEntriesSafe,
  assertCapacitorWebAssetsMatchDist,
  assertNoCapacitorGeneratedFileCollisions,
} from "../scripts/create-aab-evidence.mjs";
import { hashDirectory, hashFile, sha256 } from "../scripts/release-evidence.mjs";
import {
  ANDROID_MANIFEST_POLICY_VERSION,
  expectedReleasePermissionNames,
} from "../scripts/android-manifest-policy.mjs";

const realAppRoot = resolve(import.meta.dirname, "..");
const realWorkerRoot = realAppRoot; // worker/ 정본이 앱 저장소 안으로 이관됨

function write(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function crc32(value) {
  let checksum = 0xffffffff;
  for (const byte of value) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const contents = Buffer.isBuffer(entry.value)
      ? entry.value
      : Buffer.from(entry.value, "utf8");
    const compressionMethod = entry.compressionMethod ?? 0;
    const compressed = compressionMethod === 8 ? deflateRawSync(contents) : contents;
    const checksum = crc32(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(0o100644 * 0x10000, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    localParts.push(localHeader, name, compressed);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function validPagesEntries(assetLinksFixture) {
  return [
    { path: "index.html", value: "<!doctype html><title>candidate</title>\n" },
    { path: "_headers", value: "/*\n  X-Content-Type-Options: nosniff\n" },
    {
      path: "app-version.json",
      value: `${JSON.stringify({ minimumSupportedVersion: "1.3.0", latestVersion: "1.3.0" })}\n`,
    },
    { path: "manifest.webmanifest", value: `${JSON.stringify({ name: "혜니캘린더", start_url: "./" })}\n` },
    { path: "sw.js", value: "self.addEventListener('fetch', () => {});\n" },
    { path: ".well-known/assetlinks.json", value: assetLinksFixture },
    { path: "assets/index.js", value: "globalThis.__HYENI_RELEASE_FIXTURE__ = true;\n" },
  ];
}

function rewriteKnownGoodArchive(fixture, entries) {
  writeFileSync(fixture.archivePath, createZip(entries));
  fixture.env.HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256 = hashFile(fixture.archivePath);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function initializeRepository(root) {
  git(root, ["init"]);
  git(root, ["config", "user.email", "release-test@invalid.local"]);
  git(root, ["config", "user.name", "Release Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return git(root, ["rev-parse", "HEAD"]);
}

function createReadyFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "hyeni-release-record-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = resolve(root, "hyeni-3");
  const workerRoot = appRoot; // 단일 저장소 — worker/는 appRoot 아래
  mkdirSync(resolve(appRoot, "public"), { recursive: true });
  mkdirSync(resolve(appRoot, "android", "app"), { recursive: true });
  write(resolve(appRoot, ".gitignore"), "dist/\nartifacts/\nandroid/app/build/\nknown-good.zip\n");
  writeJson(resolve(appRoot, "package.json"), { version: "1.3.0" });
  writeJson(resolve(appRoot, "package-lock.json"), { lockfileVersion: 3 });
  writeJson(resolve(appRoot, "public", "app-version.json"), {
    minimumSupportedVersion: "1.3.0",
    latestVersion: "1.3.0",
  });
  write(resolve(appRoot, "android", "app", "build.gradle"), `
def hyeniPackageVersion = "1.3.0"
android {
  defaultConfig {
    applicationId "com.hyeni.calendar"
    versionCode 5
    versionName hyeniPackageVersion
  }
}
`);
  writeJson(resolve(workerRoot, "package-lock.json"), { lockfileVersion: 3 });
  write(resolve(workerRoot, "worker", "wrangler.toml"), `
name = "hyeni-calendar-api"

[[d1_databases]]
binding = "DB"
database_name = "hyeni-calendar"
database_id = "c08f9b89-3418-443e-9946-e6b2c68cfc4c"
`);
  write(
    resolve(workerRoot, "worker", "ops", "release-d1-readonly-preflight.sql"),
    "SELECT 24 AS required_objects, 2 AS present_objects, 22 AS missing_objects, 1 AS has_ai_schedule_limit_source;\n",
  );
  const assetLinksFixture = "[{\"relation\":[\"delegate_permission/common.handle_all_urls\"]}]\n";
  const pagesEntries = validPagesEntries(assetLinksFixture);
  const capacitorPublicPath = resolve(appRoot, "android", "app", "src", "main", "assets", "public");
  for (const entry of pagesEntries) {
    write(resolve(capacitorPublicPath, entry.path), entry.value);
  }
  for (const path of CAPACITOR_GENERATED_PUBLIC_FILES) {
    write(resolve(capacitorPublicPath, path), "");
  }
  const appSha = initializeRepository(appRoot);
  const workerSha = appSha; // 같은 저장소라 같은 커밋

  const distPath = resolve(appRoot, "dist");
  for (const entry of pagesEntries) {
    write(resolve(distPath, entry.path), entry.value);
  }
  const dist = hashDirectory(distPath);
  const androidSourceProjection = hashDirectory(distPath, {
    excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
  });
  const capacitorPublic = hashDirectory(capacitorPublicPath);
  const embeddedPublicPath = resolve(appRoot, "artifacts", "fixture-embedded-public");
  for (const entry of pagesEntries) {
    if (!ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES.includes(entry.path)) {
      write(resolve(embeddedPublicPath, entry.path), entry.value);
    }
  }
  for (const path of CAPACITOR_GENERATED_PUBLIC_FILES) {
    write(resolve(embeddedPublicPath, path), "");
  }
  const embeddedPublic = hashDirectory(embeddedPublicPath);
  const capacitorGeneratedFiles = CAPACITOR_GENERATED_PUBLIC_FILES.map((path) => ({
    path,
    bytes: 0,
    sha256: EMPTY_FILE_SHA256,
  }));
  const androidPackagingExcludedFiles = ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES.map((path) => ({
    path,
    bytes: Buffer.byteLength(assetLinksFixture),
    sha256: sha256(assetLinksFixture),
  }));
  const aabPath = resolve(appRoot, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
  write(aabPath, "signed-release-aab-fixture");
  const generatedAt = new Date().toISOString();
  const evidenceRoot = resolve(appRoot, "artifacts", "release-evidence");
  const pagesPath = resolve(evidenceRoot, "pages-dist-provenance.json");
  const pagesArtifactName = `hyeni-pages-dist-${appSha}`;
  writeJson(pagesPath, buildPagesProvenance({
    appRoot,
    distPath,
    expectedSourceCommit: appSha,
    ciRunId: "app-ci-1",
    ciRunAttempt: "1",
    repository: "owner/hyeni-3",
    generatedAt,
  }));

  const verificationLogPath = resolve(evidenceRoot, "android-release-aab-verification.txt");
  write(verificationLogPath, "machine verification fixture\n");
  const certificateSha256 = "c".repeat(64);
  const elfLibraries = [{
    path: "lib/arm64-v8a/libfixture.so",
    loadSegmentCount: 2,
    minimumLoadAlignment: 16384,
    sha256: "e".repeat(64),
  }];
  const aabEvidencePath = resolve(evidenceRoot, "android-release-aab-evidence.json");
  writeJson(aabEvidencePath, {
    schemaVersion: 4,
    artifactKind: "hyeni-android-aab",
    generatedAt,
    buildType: "release",
    sourceCommit: appSha,
    app: {
      packageName: "com.hyeni.calendar",
      packageVersion: "1.3.0",
      minimumSupportedVersion: "1.3.0",
      latestVersion: "1.3.0",
    },
    manifest: {
      versionName: "1.3.0",
      versionCode: 5,
      sourceCommit: appSha,
      debuggable: false,
      policy: {
        policyVersion: ANDROID_MANIFEST_POLICY_VERSION,
        exactApprovedPermissions: true,
        // 승인 목록이 정본이다 — 숫자를 박아 두면 권한이 하나 늘 때 fixture 가 어긋난다.
        permissionCount: expectedReleasePermissionNames("com.hyeni.calendar").length,
        permissionNames: expectedReleasePermissionNames("com.hyeni.calendar"),
        monitoringTool: "child_monitoring",
        legacyStorageMaxSdkVersion: 28,
      },
    },
    aab: {
      fileName: "app-release.aab",
      bytes: Buffer.byteLength("signed-release-aab-fixture"),
      mtime: statSync(aabPath).mtime.toISOString(),
      sha256: hashFile(aabPath),
    },
    webAssets: {
      projectionVersion: CAPACITOR_PUBLIC_PROJECTION_VERSION,
      sourceDist: { sha256: dist.sha256, fileCount: dist.fileCount },
      androidSourceProjection: {
        sha256: androidSourceProjection.sha256,
        fileCount: androidSourceProjection.fileCount,
      },
      capacitorPublic: {
        sha256: capacitorPublic.sha256,
        fileCount: capacitorPublic.fileCount,
      },
      embeddedPublic: {
        sha256: embeddedPublic.sha256,
        fileCount: embeddedPublic.fileCount,
      },
      embeddedDistProjection: {
        sha256: androidSourceProjection.sha256,
        fileCount: androidSourceProjection.fileCount,
      },
      androidPackagingExcludedFiles,
      capacitorGeneratedFiles,
      matched: true,
    },
    archiveSafety: {
      allEntriesSafe: true,
      noDuplicateOrPortableNameCollisions: true,
      noFeatureModuleWebAssets: true,
      aabEntryCount: 10,
      apksEntryCount: 5,
      universalApkEntryCount: 20,
    },
    integrity: {
      aabStableDuringVerification: true,
      sourceDistStableDuringVerification: true,
      androidSourceProjectionStableDuringVerification: true,
      capacitorPublicStableDuringVerification: true,
    },
    signature: {
      jarsignerVerified: true,
      certificateSha256,
      expectedCertificateSha256: certificateSha256,
      expectedCertificateMatched: true,
      jarsignerOutputSha256: "a".repeat(64),
      certificateOutputSha256: "b".repeat(64),
    },
    alignment16Kb: {
      bundleConfigPageAlignment16Kb: true,
      universalApkZipAligned16Kb: true,
      nativeLibraryCount: 1,
      elfLoadSegmentCount: 2,
      minimumElfLoadAlignment: 16384,
      allElfLoadSegmentsAtLeast16384: true,
      bundleConfigOutputSha256: "1".repeat(64),
      zipalignOutputSha256: "2".repeat(64),
      elfSummarySha256: sha256(`${JSON.stringify(elfLibraries)}\n`),
      elfLibraries,
    },
    tools: {
      bundletool: {
        version: APPROVED_BUNDLETOOL_VERSION,
        fileName: "bundletool.jar",
        sha256: APPROVED_BUNDLETOOL_SHA256,
      },
      java: { versionOutput: "openjdk 21" },
      jarsigner: { fileName: "jarsigner", sha256: "4".repeat(64) },
      keytool: { fileName: "keytool", sha256: "5".repeat(64) },
      zipalign: { fileName: "zipalign", sha256: "6".repeat(64) },
      readelf: { versionOutput: "LLVM 19", fileName: "llvm-readelf", sha256: "7".repeat(64) },
    },
    verificationLog: {
      fileName: "android-release-aab-verification.txt",
      bytes: Buffer.byteLength("machine verification fixture\n"),
      sha256: hashFile(verificationLogPath),
    },
  });

  const inventoryPath = resolve(evidenceRoot, "client-release-inventory.json");
  writeJson(inventoryPath, {
    schemaVersion: 1,
    artifactKind: "hyeni-client-release-inventory",
    capturedAt: generatedAt,
    appId: "com.hyeni.calendar",
    appSourceCommit: appSha,
    workerSourceCommit: workerSha,
    playConsole: {
      tracksReviewed: ["internal", "closed", "open", "production"],
      maximumPreviouslyUsedVersionCode: 4,
      evidenceReferences: ["evidence-store://play-console-all-tracks-20260801"],
    },
    existingPublicInstalls: {
      inventoryComplete: true,
      activeInstallCount: 0,
      evidenceReferences: ["evidence-store://public-install-inventory-20260801"],
    },
    cutover: { mode: "zero_public_installs" },
  });
  const launchApprovalPath = resolve(evidenceRoot, "launch-approval.json");
  writeJson(launchApprovalPath, {
    schemaVersion: 1,
    artifactKind: "hyeni-launch-approval",
    capturedAt: generatedAt,
    appSourceCommit: appSha,
    workerSourceCommit: workerSha,
    fixedPricingKrw: { monthly: 4900, annual: 39000 },
    operationalReadiness: {
      migrationRehearsalPassed: true,
      productionMigrationReadbackPassed: true,
      healthReadinessReadbackPassed: true,
      references: ["evidence-store://operations/migration-readback-20260802"],
    },
    aiProduction: {
      previousOpenAiKeyRevoked: true,
      productionOpenAiBindingReadbackPassed: true,
      productionLunaModelReadbackPassed: true,
      lunaLiveCanaryPassed: true,
      references: ["evidence-store://ai/luna-production-readback-20260802"],
    },
    paymentE2e: {
      googlePlayPurchasePassed: true,
      googlePlayRestorePassed: true,
      googlePlayRenewalPassed: true,
      googlePlayCancellationPassed: true,
      googlePlayRefundPassed: true,
      tossPurchasePassed: true,
      tossRestorePassed: true,
      tossRenewalPassed: true,
      tossCancellationPassed: true,
      tossRefundPassed: true,
      crossProviderDuplicateChargePreventionPassed: true,
      crossProviderEntitlementConsistencyPassed: true,
      references: ["evidence-store://payments/play-toss-cross-provider-e2e-20260802"],
    },
    ugcSafety: {
      reportFlowPassed: true,
      blockFlowPassed: true,
      operatorReviewPassed: true,
      appealFlowPassed: true,
      references: ["evidence-store://ugc/report-block-operator-e2e-20260802"],
    },
    legalAndPolicy: {
      termsAndPrivacyApproved: true,
      playDataSafetyApproved: true,
      childLocationLegalReviewApproved: true,
      familiesPolicyApproved: true,
      references: ["evidence-store://policy/legal-data-safety-location-20260802"],
    },
    clientStateChangingE2e: {
      iphonePwaStateChangingE2ePassed: true,
      a17ParentNativeStateChangingE2ePassed: true,
      razrChildNativeStateChangingE2ePassed: true,
      crossDeviceCriticalFlowPassed: true,
      references: ["evidence-store://clients/iphone-a17-razr-state-changing-e2e-20260802"],
    },
    storeReadiness: {
      playConsoleConfigurationApproved: true,
      piiFreeStoreAssetsApproved: true,
      fullScreenIntentDeclarationApproved: true,
      foregroundServiceDeclarationApproved: true,
      monitoringToolDeclarationApproved: true,
      targetAudienceAndIarcApproved: true,
      playAppSigningAndAssetLinksApproved: true,
      references: ["evidence-store://store/play-console-assets-declarations-20260802"],
    },
    launchOperations: {
      firstHourMonitoringPlanApproved: true,
      rollbackDrillPassed: true,
      knownGoodRecoveryVerified: true,
      primaryObserver: "release-owner",
      alternateObserver: "release-alternate",
      references: ["evidence-store://operations/first-hour-rollback-drill-20260802"],
    },
  });
  const d1PreflightResponsePath = resolve(evidenceRoot, "d1-readonly-preflight.json");
  writeJson(d1PreflightResponsePath, [{
    results: [{
      required_objects: 24,
      present_objects: 2,
      missing_objects: 22,
      duplicate_groups: 1,
      duplicate_rows: 6,
      rows_removed_by_merge: 5,
      has_ai_schedule_limit_source: 1,
    }],
    success: true,
    meta: {
      changes: 0,
      changed_db: false,
      rows_written: 0,
    },
  }]);
  const d1BookmarkEvidencePath = resolve(evidenceRoot, "d1-time-travel-bookmark.json");
  writeJson(d1BookmarkEvidencePath, {
    schemaVersion: 1,
    artifactKind: "hyeni-d1-time-travel-bookmark",
    capturedAt: generatedAt,
    captureStartedAt: new Date(Date.parse(generatedAt) - 1_000).toISOString(),
    captureCompletedAt: generatedAt,
    appSourceCommit: appSha,
    workerSourceCommit: workerSha,
    database: {
      binding: "DB",
      name: "hyeni-calendar",
      id: "c08f9b89-3418-443e-9946-e6b2c68cfc4c",
    },
    request: {
      operation: "d1-time-travel-info",
      mode: "current",
      responseFormat: "json",
      wranglerVersion: "4.118.0",
      executionCwd: "hyeni-3",
      configPath: "worker/wrangler.toml",
      cliPath: "node_modules/wrangler/bin/wrangler.js",
    },
    readOnlyPreflight: {
      capturedAt: new Date(Date.parse(generatedAt) - 2_000).toISOString(),
      sqlPath: "worker/ops/release-d1-readonly-preflight.sql",
      sqlSha256: hashFile(resolve(workerRoot, "worker", "ops", "release-d1-readonly-preflight.sql")),
      responsePath: "artifacts/release-evidence/d1-readonly-preflight.json",
      responseSha256: hashFile(d1PreflightResponsePath),
      resultRowCount: 1,
      meta: {
        changes: 0,
        changedDb: false,
        rowsWritten: 0,
      },
      summary: {
        requiredObjects: 24,
        presentObjects: 2,
        missingObjects: 22,
        duplicateGroups: 1,
        duplicateRows: 6,
        rowsRemovedByMerge: 5,
        hasAiScheduleLimitSource: 1,
      },
    },
    bookmark: "00000044-00000050-000050a7-d8a71656dd2c443d70ea06946fb501e2",
  });
  const archivePath = resolve(appRoot, "known-good.zip");
  writeFileSync(archivePath, createZip(pagesEntries));

  const env = {
    HYENI_RELEASE_APP_CI_RUN_ID: "app-ci-1",
    HYENI_RELEASE_APP_CI_SOURCE_SHA: appSha,
    HYENI_RELEASE_WORKER_CI_RUN_ID: "worker-ci-1",
    HYENI_RELEASE_WORKER_CI_SOURCE_SHA: workerSha,
    HYENI_RELEASE_PAGES_ARTIFACT_NAME: pagesArtifactName,
    HYENI_RELEASE_PAGES_PROVENANCE_PATH: pagesPath,
    HYENI_RELEASE_PAGES_PROVENANCE_SHA256: hashFile(pagesPath),
    HYENI_RELEASE_AAB_SOURCE_SHA: appSha,
    HYENI_RELEASE_AAB_EVIDENCE_PATH: aabEvidencePath,
    HYENI_RELEASE_AAB_EVIDENCE_SHA256: hashFile(aabEvidencePath),
    HYENI_RELEASE_UPLOAD_CERTIFICATE_SHA256: certificateSha256,
    HYENI_RELEASE_CLIENT_INVENTORY_PATH: inventoryPath,
    HYENI_RELEASE_CLIENT_INVENTORY_SHA256: hashFile(inventoryPath),
    HYENI_RELEASE_LAUNCH_APPROVAL_PATH: launchApprovalPath,
    HYENI_RELEASE_LAUNCH_APPROVAL_SHA256: hashFile(launchApprovalPath),
    HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_PATH: d1BookmarkEvidencePath,
    HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256: hashFile(d1BookmarkEvidencePath),
    HYENI_RELEASE_PAGES_DEPLOYMENT_ID: "pages-preview-1",
    HYENI_RELEASE_PAGES_SOURCE_SHA: appSha,
    HYENI_RELEASE_WORKER_VERSION_ID: "worker-version-1",
    HYENI_RELEASE_WORKER_SOURCE_SHA: workerSha,
    HYENI_KNOWN_GOOD_PAGES_DIST_SHA256: dist.sha256,
    HYENI_KNOWN_GOOD_PAGES_ARCHIVE_PATH: archivePath,
    HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256: hashFile(archivePath),
    HYENI_KNOWN_GOOD_WORKER_VERSION_ID: "known-good-worker-1",
    HYENI_RELEASE_OBSERVATION_OWNER: "release-owner",
  };

  return {
    appRoot,
    workerRoot,
    env,
    pagesPath,
    aabEvidencePath,
    inventoryPath,
    launchApprovalPath,
    d1PreflightResponsePath,
    d1BookmarkEvidencePath,
    distPath,
    archivePath,
    pagesEntries,
    generatedAt,
  };
}

function updateAabEvidence(fixture, update) {
  const evidence = JSON.parse(readFileSync(fixture.aabEvidencePath, "utf8"));
  update(evidence);
  writeJson(fixture.aabEvidencePath, evidence);
  fixture.env.HYENI_RELEASE_AAB_EVIDENCE_SHA256 = hashFile(fixture.aabEvidencePath);
}

function updateLaunchApproval(fixture, update) {
  const evidence = JSON.parse(readFileSync(fixture.launchApprovalPath, "utf8"));
  update(evidence);
  writeJson(fixture.launchApprovalPath, evidence);
  fixture.env.HYENI_RELEASE_LAUNCH_APPROVAL_SHA256 = hashFile(fixture.launchApprovalPath);
}

function updateD1BookmarkEvidence(fixture, update) {
  const evidence = JSON.parse(readFileSync(fixture.d1BookmarkEvidencePath, "utf8"));
  update(evidence);
  writeJson(fixture.d1BookmarkEvidencePath, evidence);
  fixture.env.HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256 = hashFile(fixture.d1BookmarkEvidencePath);
}

function createCapacitorWebAssetAssertionFixture() {
  const generatedFiles = CAPACITOR_GENERATED_PUBLIC_FILES.map((path) => ({
    path,
    bytes: 0,
    sha256: EMPTY_FILE_SHA256,
  }));
  const packagingExcludedFiles = ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES.map((path) => ({
    path,
    bytes: 338,
    sha256: "e".repeat(64),
  }));
  return {
    sourceDist: { sha256: "a".repeat(64), fileCount: 12 },
    androidSourceProjection: { sha256: "f".repeat(64), fileCount: 11 },
    capacitorPublic: { sha256: "b".repeat(64), fileCount: 14 },
    capacitorProjection: { sha256: "a".repeat(64), fileCount: 12 },
    embeddedPublic: { sha256: "c".repeat(64), fileCount: 13 },
    expectedEmbeddedPublic: { sha256: "c".repeat(64), fileCount: 13 },
    embeddedProjection: { sha256: "f".repeat(64), fileCount: 11 },
    androidPackagingExcludedFiles: packagingExcludedFiles,
    capacitorPackagingExcludedFiles: packagingExcludedFiles,
    capacitorGeneratedFiles: generatedFiles,
    embeddedGeneratedFiles: generatedFiles,
  };
}

test("릴리스 기록은 고정 가격과 현재 소스 해시를 기록하고 증거가 없으면 HOLD한다", () => {
  const record = buildReleaseRecord({
    appRoot: realAppRoot,
    workerRoot: realWorkerRoot,
    env: {},
    generatedAt: "2026-08-01T00:00:00.000Z",
  });

  assert.deepEqual(record.fixedPricingKrw, { monthly: 4900, annual: 39000 });
  assert.match(record.app.packageLockSha256, /^[a-f0-9]{64}$/);
  assert.match(record.worker.packageLockSha256, /^[a-f0-9]{64}$/);
  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("Pages provenance")));
  assert.ok(record.assessment.blockers.some((item) => item.includes("AAB machine evidence")));
  assert.ok(record.assessment.blockers.some((item) => item.includes("설치·Play inventory")));
  assert.ok(record.assessment.blockers.some((item) => item.includes("launch approval")));
});

test("현재 dist·AAB·Play inventory·strict D1 bookmark evidence가 모두 맞을 때만 사람 GO 검토 단계가 된다", (t) => {
  const fixture = createReadyFixture(t);
  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "READY_FOR_HUMAN_GO_REVIEW", record.assessment.blockers.join("\n"));
  assert.equal(record.schemaVersion, 4);
  assert.equal(record.assessment.humanApprovalRequired, true);
  assert.equal(record.machineEvidence.releaseAab.summary.versionCode, 5);
  assert.equal(
    record.machineEvidence.releaseAab.summary.manifestPermissionCount,
    expectedReleasePermissionNames("com.hyeni.calendar").length,
  );
  assert.equal(record.machineEvidence.releaseAab.summary.monitoringTool, "child_monitoring");
  assert.equal(record.machineEvidence.releaseAab.summary.minimumElfLoadAlignment, 16384);
  assert.equal(
    record.machineEvidence.releaseAab.summary.sourceDistSha256,
    hashDirectory(fixture.distPath).sha256,
  );
  assert.equal(
    record.machineEvidence.releaseAab.summary.androidSourceProjectionSha256,
    hashDirectory(fixture.distPath, {
      excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    }).sha256,
  );
  assert.equal(
    record.machineEvidence.releaseAab.summary.embeddedDistProjectionSha256,
    hashDirectory(fixture.distPath, {
      excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    }).sha256,
  );
  assert.equal(
    record.machineEvidence.releaseAab.summary.embeddedDistProjectionFileCount,
    hashDirectory(fixture.distPath, {
      excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    }).fileCount,
  );
  assert.equal(record.machineEvidence.releaseAab.summary.capacitorGeneratedFileCount, 2);
  assert.equal(record.machineEvidence.clientInventory.summary.activePublicInstallCount, 0);
  assert.equal(
    record.machineEvidence.knownGoodPagesArchive.summary.treeSha256,
    hashDirectory(fixture.distPath).sha256,
  );
  assert.equal(record.machineEvidence.knownGoodPagesArchive.summary.treeSha256Matched, true);
  assert.deepEqual(record.machineEvidence.launchApproval.summary.fixedPricingKrw, {
    monthly: 4900,
    annual: 39000,
  });
  assert.equal(record.machineEvidence.launchApproval.summary.primaryObserver, "release-owner");
  assert.equal(record.machineEvidence.launchApproval.summary.alternateObserver, "release-alternate");
  assert.equal(
    record.machineEvidence.d1TimeTravelBookmark.summary.bookmark,
    "00000044-00000050-000050a7-d8a71656dd2c443d70ea06946fb501e2",
  );
  assert.deepEqual(record.machineEvidence.d1TimeTravelBookmark.summary.database, {
    binding: "DB",
    name: "hyeni-calendar",
    id: "c08f9b89-3418-443e-9946-e6b2c68cfc4c",
  });
  assert.deepEqual(record.machineEvidence.d1TimeTravelBookmark.summary.readOnlyPreflight.summary, {
    requiredObjects: 24,
    presentObjects: 2,
    missingObjects: 22,
    duplicateGroups: 1,
    duplicateRows: 6,
    rowsRemovedByMerge: 5,
    hasAiScheduleLimitSource: 1,
  });

  const rawBookmarkFixture = createReadyFixture(t);
  delete rawBookmarkFixture.env.HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_PATH;
  delete rawBookmarkFixture.env.HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256;
  rawBookmarkFixture.env.HYENI_RELEASE_D1_BOOKMARK = "00000044-00000050-000050a7-d8a71656dd2c443d70ea06946fb501e2";
  const rawBookmarkRecord = buildReleaseRecord(rawBookmarkFixture);
  assert.equal(rawBookmarkRecord.assessment.verdict, "HOLD");
  assert.ok(rawBookmarkRecord.assessment.blockers.some((item) => item.includes("machine evidence 파일")));
  assert.ok(rawBookmarkRecord.assessment.blockers.some((item) => item.includes("원문 문자열은 증거로 인정하지 않습니다")));
  assert.equal("d1TimeTravelBookmark" in rawBookmarkRecord.externalEvidence, false);

  const malformedFixture = createReadyFixture(t);
  updateD1BookmarkEvidence(malformedFixture, (evidence) => {
    evidence.bookmark = "bookmark-1";
    evidence.request.mode = "timestamp";
  });
  const malformedRecord = buildReleaseRecord(malformedFixture);
  assert.equal(malformedRecord.assessment.verdict, "HOLD");
  assert.ok(malformedRecord.assessment.blockers.some((item) => item.includes("현재 bookmark JSON 캡처 계약")));
  assert.ok(malformedRecord.assessment.blockers.some((item) => item.includes("Cloudflare 현재 형식")));

  const staleFixture = createReadyFixture(t);
  const staleAt = new Date(Date.parse(staleFixture.generatedAt) - (11 * 60 * 1000)).toISOString();
  updateD1BookmarkEvidence(staleFixture, (evidence) => {
    evidence.capturedAt = staleAt;
    evidence.captureStartedAt = new Date(Date.parse(staleAt) - 1_000).toISOString();
    evidence.captureCompletedAt = staleAt;
  });
  const staleRecord = buildReleaseRecord(staleFixture);
  assert.equal(staleRecord.assessment.verdict, "HOLD");
  assert.ok(staleRecord.assessment.blockers.some((item) => item.includes("허용 유효기간")));

  const mismatchedFixture = createReadyFixture(t);
  updateD1BookmarkEvidence(mismatchedFixture, (evidence) => {
    evidence.appSourceCommit = "a".repeat(40);
    evidence.workerSourceCommit = "b".repeat(40);
    evidence.database.id = "11111111-1111-4111-8111-111111111111";
  });
  const mismatchedRecord = buildReleaseRecord(mismatchedFixture);
  assert.equal(mismatchedRecord.assessment.verdict, "HOLD");
  assert.ok(mismatchedRecord.assessment.blockers.some((item) => item.includes("app commit")));
  assert.ok(mismatchedRecord.assessment.blockers.some((item) => item.includes("Worker commit")));
  assert.ok(mismatchedRecord.assessment.blockers.some((item) => item.includes("정확한 D1 DB")));

  const strictFixture = createReadyFixture(t);
  updateD1BookmarkEvidence(strictFixture, (evidence) => {
    evidence.captureStartedAt = new Date(Date.parse(strictFixture.generatedAt) - (3 * 60 * 1000)).toISOString();
    evidence.untrusted = true;
    evidence.readOnlyPreflight.sqlSha256 = "0".repeat(64);
    evidence.readOnlyPreflight.responseSha256 = "invalid";
    evidence.readOnlyPreflight.meta.rowsWritten = 1;
    evidence.readOnlyPreflight.summary.missingObjects = 21;
  });
  strictFixture.env.HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256 = "f".repeat(64);
  const strictRecord = buildReleaseRecord(strictFixture);
  assert.equal(strictRecord.assessment.verdict, "HOLD");
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("expected SHA-256")));
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("strict schema")));
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("2분을 초과")));
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("SQL이 현재 Worker 정본과 다릅니다")));
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("원본 응답 SHA-256")));
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("rows_written=0")));
  assert.ok(strictRecord.assessment.blockers.some((item) => item.includes("익명 집계 불변식")));
});

test("D1 preflight의 AI 일정 source 승인 flag가 없거나 0이면 HOLD한다", (t) => {
  const missingFlagFixture = createReadyFixture(t);
  updateD1BookmarkEvidence(missingFlagFixture, (evidence) => {
    delete evidence.readOnlyPreflight.summary.hasAiScheduleLimitSource;
  });
  const missingFlagRecord = buildReleaseRecord(missingFlagFixture);
  assert.equal(missingFlagRecord.assessment.verdict, "HOLD");
  assert.ok(missingFlagRecord.assessment.blockers.some((item) => item.includes("strict schema")));

  const zeroFlagFixture = createReadyFixture(t);
  const zeroFlagResponse = JSON.parse(readFileSync(zeroFlagFixture.d1PreflightResponsePath, "utf8"));
  zeroFlagResponse[0].results[0].has_ai_schedule_limit_source = 0;
  writeJson(zeroFlagFixture.d1PreflightResponsePath, zeroFlagResponse);
  updateD1BookmarkEvidence(zeroFlagFixture, (evidence) => {
    evidence.readOnlyPreflight.summary.hasAiScheduleLimitSource = 0;
    evidence.readOnlyPreflight.responseSha256 = hashFile(zeroFlagFixture.d1PreflightResponsePath);
  });
  const zeroFlagRecord = buildReleaseRecord(zeroFlagFixture);
  assert.equal(zeroFlagRecord.assessment.verdict, "HOLD");
  assert.ok(zeroFlagRecord.assessment.blockers.some((item) => item.includes("ai_schedule_limit")));
  assert.ok(!zeroFlagRecord.assessment.blockers.some((item) => item.includes("원본 응답이 단일 행")));
});

test("launch approval evidence 파일이나 SHA-256이 없으면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  delete fixture.env.HYENI_RELEASE_LAUNCH_APPROVAL_PATH;
  delete fixture.env.HYENI_RELEASE_LAUNCH_APPROVAL_SHA256;

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("launch approval")));
});

test("launch approval의 필수 boolean이 하나라도 false이면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.paymentE2e.googlePlayRefundPassed = false;
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("googlePlayRefundPassed")));
});

test("launch approval capturedAt이 12시간보다 오래되면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.capturedAt = new Date(
      Date.parse(fixture.generatedAt) - (13 * 60 * 60 * 1000),
    ).toISOString();
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => (
    item.includes("launch approval capturedAt") && item.includes("유효기간")
  )));
});

test("launch approval expected SHA-256이 실제 파일과 다르면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  fixture.env.HYENI_RELEASE_LAUNCH_APPROVAL_SHA256 = "0".repeat(64);

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => (
    item.includes("launch approval") && item.includes("SHA-256")
  )));
});

test("launch approval app·Worker commit이 현재 후보와 다르면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.appSourceCommit = "a".repeat(40);
    evidence.workerSourceCommit = "b".repeat(40);
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("app source commit")));
  assert.ok(record.assessment.blockers.some((item) => item.includes("Worker source commit")));
});

test("launch approval 가격이 월 4,900원·연 39,000원과 다르면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.fixedPricingKrw.monthly = 5000;
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("월 4,900원·연 39,000원")));
});

test("launch approval 주·대체 관측자가 같으면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.launchOperations.alternateObserver = evidence.launchOperations.primaryObserver;
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("서로 달라야")));
});

test("launch approval의 evidence reference가 비거나 안전한 불변 reference가 아니면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.ugcSafety.references = [""];
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => (
    item.includes("ugcSafety") && item.includes("reference")
  )));
});

test("launch approval에 비밀값·token·사용자 ID 필드를 추가하면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateLaunchApproval(fixture, (evidence) => {
    evidence.aiProduction.openAiApiKey = "sk-proj-this-value-must-never-be-recorded";
    evidence.paymentE2e.accessToken = "Bearer this-value-must-never-be-recorded";
    evidence.clientStateChangingE2e.userId = "raw-user-id";
  });

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => (
    item.includes("비밀값·token·사용자 ID")
  )));
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /sk-proj-this-value|raw-user-id|Bearer this-value/);
});

test("단일 최상위 디렉터리의 deflate known-good Pages ZIP도 내부 tree가 같으면 통과한다", (t) => {
  const fixture = createReadyFixture(t);
  rewriteKnownGoodArchive(
    fixture,
    fixture.pagesEntries.map((entry) => ({
      ...entry,
      path: `dist/${entry.path}`,
      compressionMethod: 8,
    })),
  );

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "READY_FOR_HUMAN_GO_REVIEW", record.assessment.blockers.join("\n"));
  assert.equal(record.machineEvidence.knownGoodPagesArchive.summary.rootPrefix, "dist/");
  assert.equal(
    record.machineEvidence.knownGoodPagesArchive.summary.treeSha256,
    hashDirectory(fixture.distPath).sha256,
  );
});

test("known-good dist SHA 문자열만으로는 실제 ZIP 없이 READY가 될 수 없다", (t) => {
  const fixture = createReadyFixture(t);
  delete fixture.env.HYENI_KNOWN_GOOD_PAGES_ARCHIVE_PATH;
  delete fixture.env.HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256;

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("known-good Pages dist archive")));
});

test("known-good Pages 보관본이 ZIP이 아니면 archive SHA가 맞아도 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  write(fixture.archivePath, "ZIP 확장자만 붙인 일반 파일\n");
  fixture.env.HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256 = hashFile(fixture.archivePath);

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /known-good|Pages|archive|ZIP/i.test(item)));
});

test("known-good Pages ZIP의 상위 경로 탈출 entry는 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  rewriteKnownGoodArchive(fixture, [
    ...fixture.pagesEntries,
    { path: "../escape.txt", value: "escape\n" },
  ]);

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /경로|entry|archive|ZIP/i.test(item)));
});

test("known-good Pages ZIP의 동일 경로 중복 entry는 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  rewriteKnownGoodArchive(fixture, [
    ...fixture.pagesEntries,
    { path: "assets/index.js", value: "duplicate\n" },
  ]);

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /중복|충돌|entry|archive|ZIP/i.test(item)));
});

test("known-good Pages ZIP의 portable-name 충돌 entry는 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  rewriteKnownGoodArchive(fixture, [
    ...fixture.pagesEntries,
    { path: "assets/App.js", value: "upper\n" },
    { path: "assets/app.js", value: "lower\n" },
  ]);

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /portable|중복|충돌|entry|archive|ZIP/i.test(item)));
});

test("known-good Pages ZIP에 필수 PWA 파일이 빠지면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  rewriteKnownGoodArchive(
    fixture,
    fixture.pagesEntries.filter((entry) => entry.path !== "sw.js"),
  );

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /필수|PWA|sw\.js|archive|ZIP/i.test(item)));
});

test("known-good Pages ZIP 내부 tree SHA가 선언값과 다르면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  rewriteKnownGoodArchive(
    fixture,
    fixture.pagesEntries.map((entry) => (
      entry.path === "assets/index.js"
        ? { ...entry, value: "globalThis.__HYENI_RELEASE_FIXTURE__ = false;\n" }
        : entry
    )),
  );

  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /tree|SHA|내부|archive|ZIP/i.test(item)));
});

test("AAB evidence 생성기는 Android 포장 제외 파일과 두 0-byte Capacitor 파일만 허용한다", () => {
  assert.deepEqual(
    [...ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES],
    [".well-known/assetlinks.json"],
  );
  assert.deepEqual(
    [...CAPACITOR_GENERATED_PUBLIC_FILES].sort(),
    ["cordova.js", "cordova_plugins.js"],
  );
  const fixture = createCapacitorWebAssetAssertionFixture();
  const normalizedGeneratedFiles = fixture.capacitorGeneratedFiles.toSorted((left, right) => (
    left.path.localeCompare(right.path, "en")
  ));

  assert.deepEqual(assertCapacitorWebAssetsMatchDist(fixture), {
    projectionVersion: CAPACITOR_PUBLIC_PROJECTION_VERSION,
    sourceDist: fixture.sourceDist,
    androidSourceProjection: fixture.androidSourceProjection,
    capacitorPublic: fixture.capacitorPublic,
    embeddedPublic: fixture.embeddedPublic,
    embeddedDistProjection: fixture.embeddedProjection,
    androidPackagingExcludedFiles: fixture.androidPackagingExcludedFiles,
    capacitorGeneratedFiles: normalizedGeneratedFiles,
    matched: true,
  });
});

test("AAB evidence 생성기는 Android 포장 제외 allowlist의 누락·변조를 거부한다", () => {
  const fixture = createCapacitorWebAssetAssertionFixture();
  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      androidPackagingExcludedFiles: [],
      capacitorPackagingExcludedFiles: [],
    }),
    /assetlinks|packaging|포장|제외|allowlist/,
  );

  const modifiedExcludedFiles = fixture.androidPackagingExcludedFiles.map((file) => ({
    ...file,
    bytes: file.bytes + 1,
    sha256: "4".repeat(64),
  }));
  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      androidPackagingExcludedFiles: modifiedExcludedFiles,
    }),
    /assetlinks|packaging|포장|제외|allowlist/,
  );
});

test("AAB evidence 생성기는 Capacitor 생성 파일 누락·비영 파일을 거부한다", () => {
  const fixture = createCapacitorWebAssetAssertionFixture();
  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      capacitorPublic: { sha256: "1".repeat(64), fileCount: 13 },
      embeddedPublic: { sha256: "2".repeat(64), fileCount: 12 },
      capacitorGeneratedFiles: fixture.capacitorGeneratedFiles.slice(0, 1),
      embeddedGeneratedFiles: fixture.embeddedGeneratedFiles.slice(0, 1),
    }),
    /Capacitor|cordova|생성 파일/,
  );

  const nonEmptyGeneratedFiles = fixture.capacitorGeneratedFiles.map((file, index) => (
    index === 0 ? { ...file, bytes: 1, sha256: "3".repeat(64) } : file
  ));
  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      capacitorGeneratedFiles: nonEmptyGeneratedFiles,
      embeddedGeneratedFiles: nonEmptyGeneratedFiles,
    }),
    /0-byte|0 byte|Capacitor|생성 파일/,
  );
});

test("AAB evidence 생성기는 알 수 없는 추가 파일과 위조된 raw-projection 개수를 거부한다", () => {
  const fixture = createCapacitorWebAssetAssertionFixture();
  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      capacitorPublic: { sha256: "4".repeat(64), fileCount: 15 },
      capacitorProjection: { sha256: "5".repeat(64), fileCount: 13 },
    }),
    /projection|투영|현재 dist|추가 파일|web assets/,
  );

  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      embeddedPublic: { sha256: "6".repeat(64), fileCount: 14 },
      embeddedProjection: { sha256: "7".repeat(64), fileCount: 12 },
    }),
    /projection|투영|현재 dist|추가 파일|web assets/,
  );

  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      capacitorPublic: { sha256: "8".repeat(64), fileCount: 15 },
      embeddedPublic: { sha256: "9".repeat(64), fileCount: 14 },
    }),
    /fileCount|파일 수|개수|projection|투영|web assets|현재 dist/,
  );
});

test("AAB evidence 생성기는 dist 파일 누락·내용 변경·동일 개수 이름 교체를 거부한다", () => {
  const fixture = createCapacitorWebAssetAssertionFixture();
  for (const changedCapacitorProjection of [
    { sha256: "1".repeat(64), fileCount: 11 },
    { sha256: "2".repeat(64), fileCount: 12 },
  ]) {
    assert.throws(
      () => assertCapacitorWebAssetsMatchDist({
        ...fixture,
        capacitorProjection: changedCapacitorProjection,
      }),
      /projection|투영|현재 dist|web assets/,
    );
  }

  assert.throws(
    () => assertCapacitorWebAssetsMatchDist({
      ...fixture,
      embeddedProjection: { sha256: "3".repeat(64), fileCount: 11 },
    }),
    /projection|투영|현재 dist|web assets/,
  );
});

test("AAB evidence 생성기는 dist의 Capacitor 예약 파일명 충돌을 거부한다", () => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-dist-collision-"));
  try {
    write(resolve(root, "index.html"), "<!doctype html>\n");
    assert.doesNotThrow(() => assertNoCapacitorGeneratedFileCollisions(root));

    const collidingPaths = [
      ...CAPACITOR_GENERATED_PUBLIC_FILES,
      ...CAPACITOR_GENERATED_PUBLIC_FILES.map((path) => path.toUpperCase()),
    ];
    for (const reservedPath of collidingPaths) {
      write(resolve(root, reservedPath), "source collision\n");
      assert.throws(
        () => assertNoCapacitorGeneratedFileCollisions(root),
        /Capacitor|cordova|예약|충돌/,
      );
      rmSync(resolve(root, reservedPath));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AAB archive entry는 안전한 상대 경로와 base 모듈 web assets만 허용한다", () => {
  assert.doesNotThrow(() => assertArchiveEntriesSafe([
    "base/manifest/AndroidManifest.xml",
    "base/assets/public/index.html",
  ], { kind: "aab" }));

  const unsafeEntrySets = [
    ["../escape.txt"],
    ["/absolute.txt"],
    ["base\\assets\\public\\index.html"],
    ["base//assets/public/index.html"],
    ["base/./assets/public/index.html"],
    ["base/assets/public/index.html", "base/assets/public/index.html"],
    ["base/assets/public/Index.html", "base/assets/public/index.html"],
    ["base/assets/public/\u00e9.txt", "base/assets/public/e\u0301.txt"],
    ["feature/assets/public/index.html"],
  ];
  for (const entries of unsafeEntrySets) {
    assert.throws(
      () => assertArchiveEntriesSafe(entries, { kind: "aab" }),
      /archive|entry|ZIP|경로|충돌|base|assets\/public/i,
    );
  }
});

test("AAB 내부 dist 투영 또는 합성 raw tree가 기대값과 다르면 evidence 해시를 갱신해도 HOLD한다", (t) => {
  const projectionFixture = createReadyFixture(t);
  updateAabEvidence(projectionFixture, (evidence) => {
    evidence.webAssets.embeddedDistProjection.sha256 = "f".repeat(64);
  });
  const projectionRecord = buildReleaseRecord(projectionFixture);
  assert.equal(projectionRecord.assessment.verdict, "HOLD");
  assert.ok(projectionRecord.assessment.blockers.some((item) => (
    /web assets|AAB|Android|Capacitor/.test(item)
  )));

  const rawFixture = createReadyFixture(t);
  updateAabEvidence(rawFixture, (evidence) => {
    evidence.webAssets.embeddedPublic.sha256 = "6".repeat(64);
  });
  const rawRecord = buildReleaseRecord(rawFixture);
  assert.equal(rawRecord.assessment.verdict, "HOLD");
  assert.ok(rawRecord.assessment.blockers.some((item) => (
    /web assets|AAB|Android|Capacitor/.test(item)
  )));
});

test("schema v3 AAB evidence는 이전에 통과했더라도 재사용하지 않고 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateAabEvidence(fixture, (evidence) => {
    evidence.schemaVersion = 3;
  });

  const record = buildReleaseRecord(fixture);
  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("schema")));
});

test("release record는 Capacitor 생성 파일 누락과 비영 파일 evidence를 모두 거부한다", (t) => {
  const missingFixture = createReadyFixture(t);
  updateAabEvidence(missingFixture, (evidence) => {
    evidence.webAssets.capacitorGeneratedFiles = evidence.webAssets.capacitorGeneratedFiles.slice(0, 1);
    evidence.webAssets.capacitorPublic.fileCount -= 1;
    evidence.webAssets.embeddedPublic.fileCount -= 1;
  });
  const missingRecord = buildReleaseRecord(missingFixture);
  assert.equal(missingRecord.assessment.verdict, "HOLD");
  assert.ok(missingRecord.assessment.blockers.some((item) => /web assets|Capacitor|생성 파일/.test(item)));

  const nonEmptyFixture = createReadyFixture(t);
  updateAabEvidence(nonEmptyFixture, (evidence) => {
    evidence.webAssets.capacitorGeneratedFiles[0].bytes = 1;
    evidence.webAssets.capacitorGeneratedFiles[0].sha256 = "f".repeat(64);
  });
  const nonEmptyRecord = buildReleaseRecord(nonEmptyFixture);
  assert.equal(nonEmptyRecord.assessment.verdict, "HOLD");
  assert.ok(nonEmptyRecord.assessment.blockers.some((item) => (
    /web assets|Capacitor|생성 파일|0-byte/.test(item)
  )));
});

test("release record는 Android 포장 제외 파일 evidence 누락·변조를 현재 tree와 대조해 거부한다", (t) => {
  const missingFixture = createReadyFixture(t);
  updateAabEvidence(missingFixture, (evidence) => {
    evidence.webAssets.androidPackagingExcludedFiles = [];
  });
  const missingRecord = buildReleaseRecord(missingFixture);
  assert.equal(missingRecord.assessment.verdict, "HOLD");
  assert.ok(missingRecord.assessment.blockers.some((item) => /web assets|패키징|제외/.test(item)));

  const modifiedFixture = createReadyFixture(t);
  updateAabEvidence(modifiedFixture, (evidence) => {
    evidence.webAssets.androidPackagingExcludedFiles[0].bytes += 1;
    evidence.webAssets.androidPackagingExcludedFiles[0].sha256 = "7".repeat(64);
  });
  const modifiedRecord = buildReleaseRecord(modifiedFixture);
  assert.equal(modifiedRecord.assessment.verdict, "HOLD");
  assert.ok(modifiedRecord.assessment.blockers.some((item) => /web assets|패키징|제외/.test(item)));
});

test("release record는 알 수 없는 추가 파일과 위조된 raw-projection 개수를 거부한다", (t) => {
  const fixture = createReadyFixture(t);
  updateAabEvidence(fixture, (evidence) => {
    evidence.webAssets.capacitorPublic.fileCount += 1;
    evidence.webAssets.capacitorPublic.sha256 = "d".repeat(64);
    evidence.webAssets.embeddedPublic.fileCount += 1;
    evidence.webAssets.embeddedPublic.sha256 = "d".repeat(64);
  });

  const record = buildReleaseRecord(fixture);
  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /web assets|projection|투영|파일 수/.test(item)));
});

test("release record는 AAB 내부 dist 파일 누락·내용 변경·동일 개수 이름 교체를 거부한다", (t) => {
  const changedFixture = createReadyFixture(t);
  updateAabEvidence(changedFixture, (evidence) => {
    evidence.webAssets.embeddedDistProjection.sha256 = "e".repeat(64);
  });
  const changedRecord = buildReleaseRecord(changedFixture);
  assert.equal(changedRecord.assessment.verdict, "HOLD");
  assert.ok(changedRecord.assessment.blockers.some((item) => /web assets|projection|투영/.test(item)));

  const missingFixture = createReadyFixture(t);
  updateAabEvidence(missingFixture, (evidence) => {
    evidence.webAssets.embeddedDistProjection.fileCount -= 1;
    evidence.webAssets.embeddedDistProjection.sha256 = "a".repeat(64);
  });
  const missingRecord = buildReleaseRecord(missingFixture);
  assert.equal(missingRecord.assessment.verdict, "HOLD");
  assert.ok(missingRecord.assessment.blockers.some((item) => /web assets|projection|투영/.test(item)));
});

test("release record는 dist의 Capacitor 예약 파일명 충돌을 거부한다", (t) => {
  const fixture = createReadyFixture(t);
  write(resolve(fixture.distPath, "cordova.js"), "source collision\n");
  const appSha = fixture.env.HYENI_RELEASE_APP_CI_SOURCE_SHA;
  writeJson(fixture.pagesPath, buildPagesProvenance({
    appRoot: fixture.appRoot,
    distPath: fixture.distPath,
    expectedSourceCommit: appSha,
    ciRunId: "app-ci-1",
    ciRunAttempt: "1",
    repository: "owner/hyeni-3",
    generatedAt: fixture.generatedAt,
  }));
  fixture.env.HYENI_RELEASE_PAGES_PROVENANCE_SHA256 = hashFile(fixture.pagesPath);
  updateAabEvidence(fixture, (evidence) => {
    const sourceDist = hashDirectory(fixture.distPath);
    const androidSourceProjection = hashDirectory(fixture.distPath, {
      excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    });
    evidence.webAssets.sourceDist = sourceDist;
    evidence.webAssets.androidSourceProjection = androidSourceProjection;
    evidence.webAssets.embeddedDistProjection = androidSourceProjection;
    evidence.webAssets.capacitorPublic = {
      sha256: "9".repeat(64),
      fileCount: sourceDist.fileCount + 2,
    };
    evidence.webAssets.embeddedPublic = {
      sha256: "8".repeat(64),
      fileCount: androidSourceProjection.fileCount + 2,
    };
  });

  const record = buildReleaseRecord(fixture);
  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => /Capacitor|cordova|예약|충돌/.test(item)));
});

test("release record는 archive entry 안전 또는 검증 입력 무결성 evidence가 빠지면 HOLD한다", (t) => {
  const archiveFixture = createReadyFixture(t);
  updateAabEvidence(archiveFixture, (evidence) => {
    evidence.archiveSafety.noDuplicateOrPortableNameCollisions = false;
  });
  const archiveRecord = buildReleaseRecord(archiveFixture);
  assert.equal(archiveRecord.assessment.verdict, "HOLD");
  assert.ok(archiveRecord.assessment.blockers.some((item) => item.includes("archive entry")));

  const integrityFixture = createReadyFixture(t);
  updateAabEvidence(integrityFixture, (evidence) => {
    evidence.integrity.sourceDistStableDuringVerification = false;
  });
  const integrityRecord = buildReleaseRecord(integrityFixture);
  assert.equal(integrityRecord.assessment.verdict, "HOLD");
  assert.ok(integrityRecord.assessment.blockers.some((item) => item.includes("시작·종료 무결성")));
});

test("CI provenance 뒤 dist가 바뀌면 stale Pages 산출물로 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  write(resolve(fixture.distPath, "index.html"), "changed after CI provenance\n");
  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("provenance dist 해시")));
});

test("bundletool versionCode가 Gradle과 다르거나 Play 최대값을 재사용하면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  const aabEvidence = JSON.parse(readFileSync(fixture.aabEvidencePath, "utf8"));
  aabEvidence.manifest.versionCode = 4;
  writeJson(fixture.aabEvidencePath, aabEvidence);
  fixture.env.HYENI_RELEASE_AAB_EVIDENCE_SHA256 = hashFile(fixture.aabEvidencePath);
  const inventory = JSON.parse(readFileSync(fixture.inventoryPath, "utf8"));
  inventory.playConsole.maximumPreviouslyUsedVersionCode = 5;
  writeJson(fixture.inventoryPath, inventory);
  fixture.env.HYENI_RELEASE_CLIENT_INVENTORY_SHA256 = hashFile(fixture.inventoryPath);
  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("bundletool versionName/versionCode")));
  assert.ok(record.assessment.blockers.some((item) => item.includes("이미 사용된 최대 versionCode")));
});

test("AAB 최소 권한 또는 자녀 모니터링 정책 증거가 바뀌면 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  updateAabEvidence(fixture, (evidence) => {
    evidence.manifest.policy.permissionNames.push("android.permission.QUERY_ALL_PACKAGES");
    evidence.manifest.policy.permissionCount += 1;
    evidence.manifest.policy.monitoringTool = "none";
  });
  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("최소 권한·자녀 모니터링")));
});

test("사람이 넣는 서명·16KB boolean만으로 machine evidence 게이트를 통과할 수 없다", (t) => {
  const fixture = createReadyFixture(t);
  delete fixture.env.HYENI_RELEASE_AAB_EVIDENCE_PATH;
  delete fixture.env.HYENI_RELEASE_AAB_EVIDENCE_SHA256;
  fixture.env.HYENI_RELEASE_AAB_SIGNATURE_VERIFIED = "true";
  fixture.env.HYENI_RELEASE_AAB_16KB_VERIFIED = "true";
  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("AAB machine evidence")));
  assert.equal("releaseAabSignatureVerified" in record.externalEvidence, false);
  assert.equal("releaseAab16KbAlignmentVerified" in record.externalEvidence, false);
});

test("24시간이 지난 기존 설치·Play inventory로 출시 검토 단계를 통과할 수 없다", (t) => {
  const fixture = createReadyFixture(t);
  const inventory = JSON.parse(readFileSync(fixture.inventoryPath, "utf8"));
  inventory.capturedAt = "2020-01-01T00:00:00.000Z";
  writeJson(fixture.inventoryPath, inventory);
  fixture.env.HYENI_RELEASE_CLIENT_INVENTORY_SHA256 = hashFile(fixture.inventoryPath);
  const record = buildReleaseRecord(fixture);

  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => item.includes("허용 유효기간")));
});

test("평문 서명 파일 이름이나 비밀 변수는 release record에 직렬화하지 않는다", () => {
  const record = buildReleaseRecord({ appRoot: realAppRoot, workerRoot: realWorkerRoot, env: {} });
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /hyeni-upload-credentials\.txt/);
  assert.doesNotMatch(serialized, /TOSS_PAYMENTS_SECRET_KEY|GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/);
});

test("JSON evidence는 한 번 읽은 동일 byte buffer를 해시하고 파싱한다", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-json-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidencePath = resolve(root, "evidence.json");
  const raw = "{\"schemaVersion\":1,\"marker\":\"same-buffer\"}\n";
  writeFileSync(evidencePath, raw);

  const evidence = readJsonEvidence(evidencePath, root);

  assert.equal(evidence.error, null);
  assert.deepEqual(evidence.value, { schemaVersion: 1, marker: "same-buffer" });
  assert.equal(evidence.file?.bytes, Buffer.byteLength(raw));
  assert.equal(evidence.file?.sha256, sha256(Buffer.from(raw)));
});

test("JSON evidence가 descriptor 읽기 중 변조되면 stable evidence를 만들지 않는다", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hyeni-json-evidence-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidencePath = resolve(root, "evidence.json");
  writeFileSync(evidencePath, "{\"state\":\"before\"}\n");
  let tampered = false;

  const evidence = readJsonEvidence(evidencePath, root, {
    readFile(descriptor) {
      const buffer = readFileSync(descriptor);
      writeFileSync(evidencePath, `${JSON.stringify({
        state: "after",
        padding: "x".repeat(4096),
      })}\n`);
      tampered = true;
      return buffer;
    },
  });

  assert.equal(tampered, true);
  assert.equal(evidence.file, null);
  assert.equal(evidence.value, null);
  assert.equal(evidence.error, "evidence 파일이 읽는 동안 변경되었습니다.");
});

test("release record는 JSON evidence의 stat/fstat TOCTOU 변경을 HOLD한다", (t) => {
  const fixture = createReadyFixture(t);
  let tampered = false;
  const record = buildReleaseRecord({
    ...fixture,
    jsonEvidenceIo: {
      readFile(descriptor) {
        const buffer = readFileSync(descriptor);
        if (!tampered) {
          writeFileSync(fixture.pagesPath, `${JSON.stringify({
            tampered: true,
            padding: "y".repeat(4096),
          })}\n`);
          tampered = true;
        }
        return buffer;
      },
    },
  });

  assert.equal(tampered, true);
  assert.equal(record.assessment.verdict, "HOLD");
  assert.ok(record.assessment.blockers.some((item) => (
    item.includes("Pages provenance evidence를 읽을 수 없습니다")
      && item.includes("읽는 동안 변경되었습니다")
  )));
});
