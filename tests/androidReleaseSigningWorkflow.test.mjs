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

test("release AAB는 승인 인증서와 16KB 조건을 모두 검증한다", () => {
  assert.match(source, /--build-type release/);
  assert.match(source, /--expected-certificate-sha256 \$uploadCertificateSha256/);
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
