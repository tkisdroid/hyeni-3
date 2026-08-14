import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/build-android-release.ps1", "utf8");

test("release 서명 스크립트는 비밀번호를 명령행 인자로 받지 않는다", () => {
  const paramBlock = source.match(/param\([\s\S]*?\)\s*\n\s*Set-StrictMode/)?.[0] ?? "";
  assert.doesNotMatch(paramBlock, /Password|KeyAlias/i);
  assert.match(source, /Read-Host '키스토어 비밀번호' -AsSecureString/);
  assert.match(source, /Read-Host '키 비밀번호' -AsSecureString/);
});

test("키스토어 비밀번호를 먼저 확인하고 단일 PrivateKeyEntry 별칭을 자동 선택한다", () => {
  assert.match(source, /'-list' '-v'/);
  assert.match(source, /Entry type:\\s\*PrivateKeyEntry/);
  assert.match(source, /\$privateKeyAliases\.Count -eq 1/);
  assert.match(source, /\$keyAlias = \$privateKeyAliases\[0\]/);
});

test("키스토어 비밀번호·파일 형식·다중 별칭 오류를 구분한다", () => {
  assert.match(source, /키스토어 비밀번호가 일치하지 않습니다/);
  assert.match(source, /키스토어 파일 형식과 손상 여부/);
  assert.match(source, /입력한 별칭은 키스토어의 PrivateKeyEntry가 아닙니다/);
});

test("Play Console이 요구한 업로드 인증서 SHA-1과 일치하기 전에는 빌드하지 않는다", () => {
  assert.match(source, /\[string\]\$PlayUploadCertificatePath/);
  assert.match(source, /X509Certificate2/);
  assert.match(source, /\$playUploadCertificate\.GetCertHash\(\)/);
  assert.doesNotMatch(source, /76:86:58:1B:14:7A:22:36:9B:E8:69:56:66:07:D6:15:2F:5D:38:98/);
  assert.match(source, /Get-CertificateFingerprint/);
  assert.match(source, /Get-NormalizedFingerprint/);
  assert.match(source, /Play Console에 등록된 업로드 키가 아닙니다/);

  const guardIndex = source.indexOf("if ($normalizedSelectedSha1 -ne $normalizedExpectedSha1)");
  const keyPasswordIndex = source.indexOf("Read-Host '키 비밀번호' -AsSecureString");
  const buildIndex = source.indexOf("':app:bundleRelease'");
  assert.ok(guardIndex > 0);
  assert.ok(keyPasswordIndex > guardIndex);
  assert.ok(buildIndex > keyPasswordIndex);
});

test("중앙 키 보관함과 Play 인증서 파일을 우선하되 인자로 덮어쓸 수 있다", () => {
  assert.match(source, /keys\\hyeni-calendar\\android-signing\\private/);
  assert.match(source, /Join-Path \$env:USERPROFILE 'keys\\hyeni-upload\.jks'/);
  assert.match(source, /\[string\]\$KeystorePath/);
  assert.match(source, /play-console-certificates-20260804\\upload_cert\.der/);
  assert.match(source, /\$selectedKeystore = if \(\[string\]::IsNullOrWhiteSpace\(\$KeystorePath\)\)/);
  assert.match(
    source,
    /\$selectedPlayUploadCertificate = if \(\[string\]::IsNullOrWhiteSpace\(\$PlayUploadCertificatePath\)\)/,
  );
});

test("release 서명 스크립트는 네 평문 Gradle property만 제거한다", () => {
  for (const name of [
    "HYENI_KEYSTORE",
    "HYENI_KEYSTORE_PASSWORD",
    "HYENI_KEY_ALIAS",
    "HYENI_KEY_PASSWORD",
  ]) {
    assert.match(source, new RegExp(`'${name}'`));
  }
  assert.match(source, /Get-ForbiddenSigningProperties/);
  assert.match(source, /Remove-ForbiddenSigningProperties/);
  assert.match(source, /WriteAllBytes\(\$gradleProperties, \$originalGradleState\.Bytes\)/);
});

test("release 빌드 성공 전에는 평문 자격정보 파일을 삭제하지 않는다", () => {
  const buildIndex = source.indexOf("$releaseBuildSucceeded = $true");
  const cleanupIndex = source.indexOf("Clear-LegacyCredentialFile", buildIndex);
  assert.ok(buildIndex > 0);
  assert.ok(cleanupIndex > buildIndex);
});

test("release 서명 스크립트는 기존 AAB를 보관하고 clean source만 허용한다", () => {
  assert.match(source, /Archive-ExistingReleaseAab/);
  assert.match(source, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(source, /release AAB는 clean worktree에서만 만들 수 있습니다/);
  assert.doesNotMatch(source, /Remove-Item[\s\S]{0,120}app-release\.aab/i);
});

test("release 서명 스크립트는 Android SDK를 빌드 전에 찾아 Gradle 환경에 전달한다", () => {
  const sdkResolveIndex = source.indexOf("$sdkRoot = Get-AndroidSdkRoot");
  const webBuildIndex = source.indexOf("& npm.cmd run build");
  const releaseBuildIndex = source.indexOf("':app:bundleRelease'");

  assert.ok(sdkResolveIndex > 0);
  assert.ok(sdkResolveIndex < webBuildIndex);
  assert.ok(sdkResolveIndex < releaseBuildIndex);

  const sdkSetup = source.slice(sdkResolveIndex, webBuildIndex);
  assert.match(sdkSetup, /\$env:ANDROID_SDK_ROOT = \$sdkRoot/);
  assert.match(sdkSetup, /\$env:ANDROID_HOME = \$sdkRoot/);
  assert.equal(source.match(/\$sdkRoot = Get-AndroidSdkRoot/g)?.length, 1);
});

test("연결 worktree release 빌드는 정본 .env의 Kakao 공개 키만 값 노출 없이 전달한다", () => {
  assert.match(source, /Get-RequiredViteKakaoKeyState/);
  assert.match(source, /--git-common-dir/);
  assert.match(source, /VITE_KAKAO_APP_KEY/);
  assert.match(source, /viteKakaoKeyConfigured/);
  assert.match(source, /viteKakaoKeySource/);
  assert.doesNotMatch(source, /\$envCandidates \| Sort-Object/);

  const currentEnvIndex = source.indexOf("$envCandidates = @((Join-Path $repoRoot '.env'))");
  const primaryEnvIndex = source.indexOf("$envCandidates += Join-Path $primaryWorktreeRoot '.env'");
  assert.ok(currentEnvIndex > 0);
  assert.ok(currentEnvIndex < primaryEnvIndex);

  const resolveIndex = source.indexOf("$viteKakaoKeyState = Get-RequiredViteKakaoKeyState");
  const webBuildIndex = source.indexOf("& npm.cmd run build");
  assert.ok(resolveIndex > 0);
  assert.ok(resolveIndex < webBuildIndex);

  const buildSetup = source.slice(resolveIndex, webBuildIndex);
  assert.match(buildSetup, /\$env:VITE_KAKAO_APP_KEY = \$viteKakaoKeyState\.Value/);
  assert.doesNotMatch(source, /Write-(?:Host|Output)[^\n]*\$viteKakaoKeyState\.Value/);
  assert.match(source, /Restore-ViteKakaoKeyEnvironment/);
});

test("release 증거 도구는 웹 빌드와 비밀번호 입력 전에 모두 확인한다", () => {
  const webBuildIndex = source.indexOf("& npm.cmd run build");
  const passwordIndex = source.indexOf("Read-Host '키스토어 비밀번호' -AsSecureString");
  const bundletoolIndex = source.indexOf("Ensure-Bundletool");
  const zipalignIndex = source.indexOf("$zipalign = Find-LatestTool");
  const readelfIndex = source.indexOf("$readelf = Find-LatestTool");

  for (const index of [bundletoolIndex, zipalignIndex, readelfIndex]) {
    assert.ok(index > 0);
    assert.ok(index < webBuildIndex);
    assert.ok(index < passwordIndex);
  }
  assert.equal(source.match(/Ensure-Bundletool/g)?.length, 2); // 함수 선언 + 호출
  assert.equal(source.match(/\$zipalign = Find-LatestTool/g)?.length, 1);
  assert.equal(source.match(/\$readelf = Find-LatestTool/g)?.length, 1);
});

test("release AAB는 승인 인증서와 16KB 조건을 모두 검증한다", () => {
  assert.match(source, /--build-type release/);
  assert.match(source, /--expected-certificate-sha256 \$uploadCertificateSha256/);
  assert.doesNotMatch(source, /63e5246e21e4ec4df27b597749c6da12749592b20e342ef8272a3b7b5fc8cc5f/i);
  assert.match(source, /expectedCertificateMatched/);
  assert.match(source, /bundleConfigPageAlignment16Kb/);
  assert.match(source, /universalApkZipAligned16Kb/);
  assert.match(source, /allElfLoadSegmentsAtLeast16384/);
});

test("Play 업로드 폴더는 AAB를 명시하고 ZIP·debug 업로드를 금지한다", () => {
  assert.match(source, /Google Play Console 업로드 대상은/);
  assert.match(source, /ZIP 파일과 debug AAB는 업로드하지 마세요/);
  assert.match(source, /play-upload-v/);
});

test("서명 환경변수는 성공과 실패 모두 finally에서 제거한다", () => {
  assert.match(source, /finally \{[\s\S]*Clear-SigningEnvironment[\s\S]*Clear-ReleaseEvidenceEnvironment/);
});
