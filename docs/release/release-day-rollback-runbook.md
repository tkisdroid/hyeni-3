# 혜니캘린더 출시일·롤백·첫 60분 운영 런북

- 적용 대상: `hyeni-3` PWA·Android 앱, `hyeni-3/worker`(같은 저장소), 운영 D1
- 가격 정본: Premium 월 4,900원·연 39,000원
- 기준 시간대: 운영 기록은 UTC, 사람 간 의사결정 시각은 Asia/Seoul을 함께 기록
- 기본 판정: **HOLD**

이 문서는 실행 순서와 중단 기준을 정하지만 배포 권한을 부여하지 않는다. 운영 D1 migration,
Worker·Pages 배포, Play Console 출시는 권한을 가진 운영 책임자가 승인한 변경 창에서만 수행한다.
로컬 테스트가 통과했더라도 외부 증거가 하나라도 없으면 `HOLD`다.

Cloudflare Worker 롤백은 선택한 이전 버전을 즉시 100% 활성 배포로 만들지만 D1·R2·KV·Durable
Object 상태는 되돌리지 않는다. Pages의 이전 production deployment는 Dashboard에서 롤백할 수
있고 preview deployment는 롤백 대상이 아니다. 현재 동작의 정본은 다음 공식 문서다.

- Worker 롤백: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Pages 롤백: https://developers.cloudflare.com/pages/configuration/rollbacks/
- Pages Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/

## 1. 판정 상태

| 상태 | 의미 | 허용 행동 |
|---|---|---|
| `HOLD` | 필수 증거 누락, 오류 조사 중, 승인 전 | 읽기 전용 조사와 로컬 검증만 수행한다. production 변경과 Play rollout 확대를 하지 않는다. |
| `READY_FOR_HUMAN_GO_REVIEW` | release record의 기계 검사가 모두 통과 | 운영·정책 책임자가 증거를 직접 확인한다. 이 상태만으로 배포하지 않는다. |
| `GO` | 책임자가 동일 SHA·외부 증거·롤백 수단을 서명 승인 | 승인된 변경 창의 정확한 배포 단계만 수행한다. |
| `ROLLBACK` | 배포 뒤 중단 기준이 발생 | 영향 계층만 검증된 known-good로 되돌리고 신규 rollout을 중단한다. |

CI 성공, 테스트 수, 에이전트 판단은 사람의 `GO`를 대체하지 않는다. 첫 60분이 끝나도 관측
기록과 책임자 서명이 없으면 `HOLD`를 유지한다.

## 2. 출시 전 절대 게이트

다음 항목이 모두 증거로 연결되기 전에는 출시 작업을 시작하지 않는다.

1. 앱·Worker worktree가 clean이고 각각의 commit SHA와 `package-lock.json` SHA-256이 기록돼 있다.
2. Worker 정본은 같은 저장소의 `worker/` 디렉터리다. 과거 교차 저장소 설정
   `HYENI_WORKER_REPOSITORY`·`HYENI_APP_REPOSITORY`와 `HYENI_CROSS_REPO_TOKEN` secret은 이관으로 폐지됐고,
   두 workflow(worker-quality·release-candidate)가 checkout 뒤 실제 `git rev-parse HEAD`까지 대조한
   동일 SHA green run ID가 있다.
3. 앱 green CI에서 받은 `hyeni-pages-dist-{appSha}` artifact의 `dist`와 provenance manifest를 함께 보존한다.
   provenance의 source SHA·CI run ID·package/app-version·lockfile·dist tree hash가 현재 후보와 모두 같아야 한다.
4. 최신 clean 앱 SHA에서 새로 만든 release AAB만 사용한다. AAB manifest에 삽입된 source SHA와 bundletool의
   package·versionName·versionCode, 승인 권한 24개 exact allowlist, `isMonitoringTool=child_monitoring`,
   legacy 저장소 `maxSdkVersion=28`, `jarsigner` 서명, upload certificate SHA-256,
   `PAGE_ALIGNMENT_16K`, universal APK `zipalign -P 16`, 모든 ELF `LOAD >= 0x4000` 결과를
   원본 검증 로그·AAB SHA-256과 하나의 machine evidence로 묶는다. 사람이 넣은 확인 boolean은 증거가 아니다.
5. Play 전체 트랙의 후보 이전 최대 versionCode와 기존 공개 설치 수를 evidence reference가 있는 inventory로
   고정한다. 기존 공개 설치가 정확히 0이 아니면 승인된 compatibility cutover와 대상 계정·트랙에서
   v1.3.0(5)가 실제 설치 가능하다는 증거를 먼저 확보한다. 이 증거 없이 `minimumSupportedVersion=1.3.0` Pages를
   먼저 배포하면 1.2.0 사용자를 업데이트 불가 화면에 잠그므로 즉시 `HOLD`다.
6. `docs/store/play-release-checklist.md`의 `2026-08-01 Worker migration-first manifest`를 격리 D1
   사본에서 순서대로 rehearsal했고, 운영 스키마 분기와 각 readback을 책임자가 승인했다.
7. migration 직전 10분 안에 읽기 전용 `wrangler d1 time-travel info --json`으로 캡처한 D1 Time Travel
   bookmark machine evidence가 있다. evidence는 Cloudflare bookmark 형식, 2분 이내 캡처 창, exact app·Worker SHA,
   현재 `wrangler.toml`의 `DB` binding·`hyeni-calendar` 이름·database UUID, 파일 SHA-256에 결박한다. 원문 문자열이나
   이전 출시 evidence는 인정하지 않는다. migration이 제거하거나 병합할 행은 별도 제한 저장소에 행 단위 복구 자료로 보존한다.
   형식과 current bookmark 의미는 [Cloudflare D1 Time Travel 공식 문서](https://developers.cloudflare.com/d1/reference/time-travel/)와
   [bookmark API 계약](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/)을 따른다.
8. 직전 known-good Pages production deployment ID, 그 배포와 동일한 `dist` 보관본·tree SHA-256,
   앱 SHA를 함께 보존했다. 해시만 있고 실제 파일이 없으면 `HOLD`다. release record는 ZIP 보관본의
   archive 자체 SHA-256과 내부 tree SHA-256을 실제 entry 바이트에서 각각 다시 계산해 둘을 묶는다.
   일반 파일에 `.zip` 확장자만 붙인 경우, zip-slip 경로, 중복 entry·portable-name 충돌, 필수 PWA 파일
   누락, 내부 tree hash 불일치는 모두 `HOLD`다.
9. 직전 known-good Worker version ID가 최근 버전 목록에 남아 있고, 적용 후 additive schema와 호환됨을
   코드와 rehearsal로 확인했다.
10. Play 월 4,900원·연 39,000원, 정확한 7일 eligible offer, Toss 계약·환경·migration·sandbox E2E,
   실제 결제·복원·갱신·해지·환불 증거가 있다.
11. AI·UGC 운영 담당자, 대응 창구, `docs/ugc-moderation-operations.md`의 운영 증거와 실제 데모 E2E가 있다.
12. Data Safety·Families·위치·FGS·FSI·모니터링·IARC·심사 접근·개인정보 없는 스토어 자산을
    정책 책임자가 승인했다.
13. 첫 60분 주 담당자와 대체 담당자, 판정 채널, 실행 시각, known-good 복구 담당자가 정해져 있다.
14. 위 6·10~13항과 production Luna 전환, iPhone PWA·A17 부모·razr 아이 상태 변경 E2E를
    `hyeni-launch-approval` schema v1 JSON 하나에 모았다. 이 파일은 exact app·Worker commit, 월 4,900원·
    연 39,000원, 12시간 이내 `capturedAt`, 모든 필수 boolean `true`, 섹션별 불변 evidence reference,
    서로 다른 주·대체 관측 역할명을 포함하고 파일 SHA-256으로 고정돼야 한다. 파일·해시 중 하나라도 없으면 `HOLD`다.

`과거 Worker 저장소(hyeni-1)의 release-cutover-preflight 스크립트`는 hyeni-1 폐기와 함께 사라졌고
이 출시 계약의 정본이 아니다. 유사 스크립트를 되살리지 않는다. 그 스크립트는 평문 환경 파일을 읽고
현재 결제·추천·퍼널·금융·위치 계약을 모두 검증하지 못했다.

## 3. 불변 release record 만들기

다음 환경 변수에는 비밀값이 아니라 승인된 증거 ID·해시·attestation만 넣는다. 서명 비밀번호,
API token, 결제 키, access·refresh·purchase token은 환경 변수나 release record에 넣지 않는다.

과거의 두 저장소 Actions repository variable(`HYENI_WORKER_REPOSITORY`·`HYENI_APP_REPOSITORY` 등)과
`HYENI_CROSS_REPO_TOKEN` secret은 Worker 이관으로 폐지됐다. Worker와 앱은 같은 저장소의 같은 commit에서
함께 검증되므로 별도 설정이 필요 없고, branch나 tag를 SHA 대신 입력하지 않는다.

release record가 production 배포 ID를 요구해 사전 승인이 순환하지 않도록, 먼저 트래픽을 받지 않는
Worker Version과 Pages preview를 동일 SHA 산출물로 만든다. Pages는 로컬 `npm run build` 결과가 아니라
동일 SHA green 앱 CI가 업로드한 immutable artifact만 사용한다. 두 작업은 production 트래픽을 바꾸지 않지만
외부 쓰기이므로 운영 책임자의 출시 준비 승인을 받은 뒤에만 실행한다. Worker는 이후 새로 build/deploy하지
않고 이때 확정한 version ID를 그대로 100% 배포한다. Pages는 preview와 production의 deployment ID가 서로
다르므로 같은 provenance·`dist` tree hash와 app SHA를 묶고, production 배포 직후 실제 production ID로 record를 다시 만든다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
$workerSha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $workerSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'Worker SHA를 확인하지 못했습니다.' }
$workerTag = "release-$($workerSha.Substring(0,12))"
npx wrangler versions upload --tag $workerTag --message="혜니캘린더 출시 후보 Worker $workerSha" --preview-alias=$workerTag --keep-vars --strict
if ($LASTEXITCODE -ne 0) { throw 'Worker 후보 Version 업로드에 실패했습니다.' }
npx wrangler versions list --name hyeni-calendar-api --json
$candidateWorkerVersionId = Read-Host '방금 업로드한 Worker candidate version ID'
if ($candidateWorkerVersionId -notmatch '^[0-9a-fA-F-]{20,64}$') { throw '올바른 Worker version ID가 아닙니다.' }
$workerRepository = Read-Host 'Worker GitHub owner/repository'
$workerCiRunId = Read-Host '동일 Worker SHA의 green CI run ID'
$workerCi = gh run view $workerCiRunId --repo $workerRepository --json headSha,conclusion | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $workerCi.conclusion -ne 'success' -or $workerCi.headSha -ne $workerSha) {
  throw 'Worker CI run이 success가 아니거나 source SHA가 현재 Worker와 다릅니다.'
}

Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$appSha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $appSha -notmatch '^[0-9a-fA-F]{40}$') { throw '앱 SHA를 확인하지 못했습니다.' }
$appRepository = Read-Host '앱 GitHub owner/repository'
$appCiRunId = Read-Host '동일 앱 SHA의 green CI run ID'
$appCi = gh run view $appCiRunId --repo $appRepository --json headSha,conclusion | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $appCi.conclusion -ne 'success' -or $appCi.headSha -ne $appSha) {
  throw '앱 CI run이 success가 아니거나 source SHA가 현재 앱과 다릅니다.'
}
$pagesArtifactName = "hyeni-pages-dist-$appSha"
$pagesArtifactRoot = Join-Path ([System.IO.Path]::GetTempPath()) "hyeni-pages-artifact-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $pagesArtifactRoot | Out-Null
gh run download $appCiRunId --repo $appRepository --name $pagesArtifactName --dir $pagesArtifactRoot
if ($LASTEXITCODE -ne 0) { throw '검증된 Pages CI artifact 다운로드에 실패했습니다.' }
$pagesDistPath = (Resolve-Path -LiteralPath (Join-Path $pagesArtifactRoot 'dist')).Path
$pagesProvenancePath = (Resolve-Path -LiteralPath (Join-Path $pagesArtifactRoot 'artifacts/release-evidence/pages-dist-provenance.json')).Path
$pagesProvenanceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $pagesProvenancePath).Hash.ToLowerInvariant()
$candidateBranch = "release-candidate-$($appSha.Substring(0,12))"
$pagesOpsDir = Join-Path ([System.IO.Path]::GetTempPath()) "hyeni-pages-candidate-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $pagesOpsDir | Out-Null
Push-Location -LiteralPath $pagesOpsDir
try {
  npx wrangler pages deploy $pagesDistPath --project-name=hyeni-calendar --branch=$candidateBranch --commit-hash=$appSha --commit-message="혜니캘린더 출시 후보 $appSha" --commit-dirty=false
  if ($LASTEXITCODE -ne 0) { throw 'Pages 후보 preview 배포에 실패했습니다.' }
  npx wrangler pages deployment list --project-name=hyeni-calendar --environment=preview --json
} finally {
  Pop-Location
}
$candidatePagesDeploymentId = Read-Host '방금 만든 Pages candidate preview deployment ID'
if (-not $candidatePagesDeploymentId.Trim()) { throw 'Pages candidate deployment ID가 필요합니다.' }
```

최종 서명 환경변수는 `docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md` 4절대로
운영자가 보이지 않는 입력으로 현재 PowerShell process에만 둔다. 에이전트와 스크립트는 비밀번호나 키스토어
내용을 읽어 출력하지 않는다. 아래 machine evidence는 빌드 뒤 실제 AAB를 공식 bundletool 1.18.1,
JDK `jarsigner`·`keytool`, Android SDK `zipalign`, NDK `llvm-readelf`로 검사한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
if ((git status --porcelain=v1 --untracked-files=all)) { throw 'release AAB는 clean worktree에서만 만들 수 있습니다.' }
if (-not $env:BUNDLETOOL_JAR -or -not (Test-Path -LiteralPath $env:BUNDLETOOL_JAR -PathType Leaf)) {
  throw '공식 bundletool-all-1.18.1.jar 경로가 BUNDLETOOL_JAR에 필요합니다.'
}
$bundletoolSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $env:BUNDLETOOL_JAR).Hash.ToLowerInvariant()
if ($bundletoolSha256 -ne '675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c') {
  throw 'bundletool-all-1.18.1.jar SHA-256이 승인값과 다릅니다.'
}
npm ci
npm run build
npx cap sync android
Push-Location -LiteralPath 'android'
try {
  .\gradlew.bat --no-daemon bundleRelease
  if ($LASTEXITCODE -ne 0) { throw 'release AAB 빌드에 실패했습니다.' }
} finally {
  Pop-Location
}
$aabPath = (Resolve-Path -LiteralPath 'android/app/build/outputs/bundle/release/app-release.aab').Path
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$ndk = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'ndk') -Directory |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$zipalignPath = Join-Path $buildTools.FullName 'zipalign.exe'
$readelfPath = Join-Path $ndk.FullName 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe'
$uploadCertificateSha256 = (Read-Host 'Play Console과 대조한 upload certificate SHA-256').Replace(':','').ToLowerInvariant()
if ($uploadCertificateSha256 -notmatch '^[0-9a-f]{64}$') { throw 'upload certificate SHA-256 형식이 올바르지 않습니다.' }
$aabEvidencePath = (Join-Path (Get-Location) 'artifacts/release-evidence/android-release-aab-evidence.json')
$aabVerificationLogPath = (Join-Path (Get-Location) 'artifacts/release-evidence/android-release-aab-verification.txt')
npm run release:aab-evidence -- --aab $aabPath --bundletool-jar $env:BUNDLETOOL_JAR --zipalign $zipalignPath --readelf $readelfPath --build-type release --expected-source-sha $appSha --expected-certificate-sha256 $uploadCertificateSha256 --out $aabEvidencePath --verification-log-out $aabVerificationLogPath
if ($LASTEXITCODE -ne 0) { throw 'release AAB machine evidence 생성에 실패했습니다.' }
$aabEvidenceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $aabEvidencePath).Hash.ToLowerInvariant()
```

다음 inventory에는 사용자 ID나 기기 식별자를 넣지 않고, 제한 증거 저장소의 불변 reference만 넣는다.
`maximumPreviouslyUsedVersionCode`는 후보 업로드 전에 전체 트랙에서 확인한 최대값이다. 기존 공개 설치가
1건 이상이면 후보가 그 설치 대상 계정·트랙에서 실제 설치 가능해진 뒤에만 compatibility 승인 정보를 만든다.

```powershell
$playMaximumVersionCode = [int](Read-Host '후보 이전 Play 전체 트랙 최대 versionCode')
$playEvidenceReference = Read-Host '전체 트랙·최대 versionCode 증거 reference'
$activePublicInstallCount = [int](Read-Host '현재 활성 공개 설치 수')
$installEvidenceReference = Read-Host '공개 설치 inventory 증거 reference'
$candidateAvailability = $null
if ($activePublicInstallCount -eq 0) {
  $cutover = [ordered]@{ mode = 'zero_public_installs' }
} else {
  $approvedBy = Read-Host 'compatibility cutover 승인 책임자'
  $approvalReference = Read-Host 'compatibility 승인 증거 reference'
  $availabilityReference = Read-Host 'v1.3.0(5) 대상 계정·트랙 설치 가능 증거 reference'
  $cutover = [ordered]@{
    mode = 'compatibility_cutover_approved'
    approval = [ordered]@{
      approved = $true
      approvedBy = $approvedBy
      approvedAt = (Get-Date).ToUniversalTime().ToString('o')
      evidenceReference = $approvalReference
    }
  }
  $candidateAvailability = [ordered]@{
    availableToExistingInstalls = $true
    versionCode = 5
    versionName = '1.3.0'
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
    evidenceReferences = @($availabilityReference)
  }
}
$clientInventoryPath = Join-Path (Get-Location) 'artifacts/release-evidence/client-release-inventory.json'
$clientInventory = [ordered]@{
  schemaVersion = 1
  artifactKind = 'hyeni-client-release-inventory'
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  appId = 'com.hyeni.calendar'
  appSourceCommit = $appSha
  workerSourceCommit = $workerSha
  playConsole = [ordered]@{
    tracksReviewed = @('internal','closed','open','production')
    maximumPreviouslyUsedVersionCode = $playMaximumVersionCode
    evidenceReferences = @($playEvidenceReference)
    candidateAvailability = $candidateAvailability
  }
  existingPublicInstalls = [ordered]@{
    inventoryComplete = $true
    activeInstallCount = $activePublicInstallCount
    evidenceReferences = @($installEvidenceReference)
  }
  cutover = $cutover
}
New-Item -ItemType Directory -Path (Split-Path -Parent $clientInventoryPath) -Force | Out-Null
$clientInventory | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $clientInventoryPath -Encoding utf8NoBOM
$clientInventorySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $clientInventoryPath).Hash.ToLowerInvariant()
```

다음 launch approval은 외부 Console·실기기·운영 readback을 하나의 strict 입력으로 묶는다. boolean을 먼저
체크하고 나중에 증거를 채우지 않는다. 각 `APPROVED` 입력 전에 제한 증거 저장소의 실제 자료를 열어 확인하고,
그 자료를 가리키는 `evidence-store://` reference를 입력한다. reference에는 쿼리 문자열·서명 URL·비밀값을 넣지 않는다.
이 JSON의 boolean 자체는 원 증거가 아니며, reference가 가리키는 변경 불가능한 자료가 원 증거다.
파일의 유효기간은 12시간이며, exact app·Worker commit이 달라지면 모든 상태 변경 E2E와 승인을 새 후보로 다시 수행한다.

launch approval에는 API key, secret, access·refresh·purchase·order·session token, 비밀번호, raw user/family ID를
절대 넣지 않는다. 관측자는 개인 계정 ID가 아니라 `release-primary` 같은 운영 역할명만 쓴다. strict schema 밖의
필드가 하나라도 있거나 secret-like 값이 감지되면 release record schema v4는 `HOLD`한다.

```powershell
function Confirm-ExternalGate([string]$label) {
  $confirmation = Read-Host "$label 증거를 직접 확인한 뒤 APPROVED 입력"
  if ($confirmation -cne 'APPROVED') { throw "$label 승인이 완료되지 않았습니다." }
  return $true
}

function Read-EvidenceReference([string]$label) {
  $reference = Read-Host "$label 불변 evidence-store reference"
  if ($reference -notmatch '^evidence-store://[A-Za-z0-9][A-Za-z0-9._/-]{2,198}$') {
    throw "$label reference 형식이 올바르지 않습니다."
  }
  return $reference
}

$primaryObserver = Read-Host '첫 60분 주 관측 역할명'
$alternateObserver = Read-Host '첫 60분 대체 관측 역할명'
$observerPattern = '^(release|ops|incident|policy)-[a-z0-9][a-z0-9-]{1,55}$'
if ($primaryObserver -notmatch $observerPattern -or $alternateObserver -notmatch $observerPattern) {
  throw '관측자는 release·ops·incident·policy 접두사를 쓴 운영 역할명이어야 합니다.'
}
if ($primaryObserver -eq $alternateObserver) { throw '주 관측자와 대체 관측자는 서로 달라야 합니다.' }

$launchApprovalPath = Join-Path (Get-Location) 'artifacts/release-evidence/launch-approval.json'
$launchApproval = [ordered]@{
  schemaVersion = 1
  artifactKind = 'hyeni-launch-approval'
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  appSourceCommit = $appSha
  workerSourceCommit = $workerSha
  fixedPricingKrw = [ordered]@{ monthly = 4900; annual = 39000 }
  operationalReadiness = [ordered]@{
    migrationRehearsalPassed = Confirm-ExternalGate '격리 D1 migration rehearsal'
    productionMigrationReadbackPassed = Confirm-ExternalGate '운영 migration 적용과 table·column·index readback'
    healthReadinessReadbackPassed = Confirm-ExternalGate '운영 health readiness exact readback'
    references = @(Read-EvidenceReference '운영 migration·readiness')
  }
  aiProduction = [ordered]@{
    previousOpenAiKeyRevoked = Confirm-ExternalGate '이전 OpenAI key 폐기'
    productionOpenAiBindingReadbackPassed = Confirm-ExternalGate 'production OpenAI binding 교체 readback'
    productionLunaModelReadbackPassed = Confirm-ExternalGate 'production gpt-5.6-luna model readback'
    lunaLiveCanaryPassed = Confirm-ExternalGate '교체된 production binding의 Luna live canary'
    references = @(Read-EvidenceReference 'Luna production 전환')
  }
  paymentE2e = [ordered]@{
    googlePlayPurchasePassed = Confirm-ExternalGate 'Google Play 실제 신규 구매'
    googlePlayRestorePassed = Confirm-ExternalGate 'Google Play 실제 복원'
    googlePlayRenewalPassed = Confirm-ExternalGate 'Google Play 실제 갱신'
    googlePlayCancellationPassed = Confirm-ExternalGate 'Google Play 실제 해지와 기간 종료'
    googlePlayRefundPassed = Confirm-ExternalGate 'Google Play 실제 환불과 entitlement 회수'
    tossPurchasePassed = Confirm-ExternalGate 'Toss 실제 신규 구매'
    tossRestorePassed = Confirm-ExternalGate 'Toss 실제 결제 완료 재조회·복원'
    tossRenewalPassed = Confirm-ExternalGate 'Toss 실제 정기 갱신'
    tossCancellationPassed = Confirm-ExternalGate 'Toss 실제 해지와 기간 종료'
    tossRefundPassed = Confirm-ExternalGate 'Toss 실제 환불과 entitlement 회수'
    crossProviderDuplicateChargePreventionPassed = Confirm-ExternalGate 'Play·Toss 교차결제 중복 청구 방지'
    crossProviderEntitlementConsistencyPassed = Confirm-ExternalGate 'Play·Toss 교차결제 entitlement 일관성'
    references = @(Read-EvidenceReference 'Play·Toss 실제 결제 E2E')
  }
  ugcSafety = [ordered]@{
    reportFlowPassed = Confirm-ExternalGate 'AI·메모 신고 실제 흐름'
    blockFlowPassed = Confirm-ExternalGate '메모 차단·해제와 안전 기능 분리'
    operatorReviewPassed = Confirm-ExternalGate '운영자 claim·검토·종결'
    appealFlowPassed = Confirm-ExternalGate '사용자 이의 제기와 응답 창구'
    references = @(Read-EvidenceReference 'UGC 신고·차단·운영자 E2E')
  }
  legalAndPolicy = [ordered]@{
    termsAndPrivacyApproved = Confirm-ExternalGate '이용약관·개인정보처리방침 승인'
    playDataSafetyApproved = Confirm-ExternalGate 'Play Data Safety 승인'
    childLocationLegalReviewApproved = Confirm-ExternalGate '아동 위치·정밀 위치 법률 검토 승인'
    familiesPolicyApproved = Confirm-ExternalGate 'Google Play Families 정책 승인'
    references = @(Read-EvidenceReference '법률·Data Safety·Families')
  }
  clientStateChangingE2e = [ordered]@{
    iphonePwaStateChangingE2ePassed = Confirm-ExternalGate 'iPhone 홈 화면 PWA 상태 변경 E2E'
    a17ParentNativeStateChangingE2ePassed = Confirm-ExternalGate 'A17 부모 기존 세션 native 상태 변경 E2E'
    razrChildNativeStateChangingE2ePassed = Confirm-ExternalGate 'razr 아이 기존 세션 native 상태 변경 E2E'
    crossDeviceCriticalFlowPassed = Confirm-ExternalGate '부모·아이 교차 기기 중요 흐름 E2E와 원복'
    references = @(Read-EvidenceReference 'iPhone PWA·A17·razr 상태 변경 E2E')
  }
  storeReadiness = [ordered]@{
    playConsoleConfigurationApproved = Confirm-ExternalGate 'Play Console 상품·트랙·심사 접근 설정'
    piiFreeStoreAssetsApproved = Confirm-ExternalGate '개인정보 없는 스토어 그래픽·스크린샷'
    fullScreenIntentDeclarationApproved = Confirm-ExternalGate 'FSI 선언과 Play 승인'
    foregroundServiceDeclarationApproved = Confirm-ExternalGate 'FGS 유형·권한·Play 선언 승인'
    monitoringToolDeclarationApproved = Confirm-ExternalGate 'isMonitoringTool 자녀 모니터링 선언 승인'
    targetAudienceAndIarcApproved = Confirm-ExternalGate '대상 연령·Families·IARC 승인'
    playAppSigningAndAssetLinksApproved = Confirm-ExternalGate 'Play App Signing 인증서·assetlinks 승인'
    references = @(Read-EvidenceReference 'Play Console·스토어 자산·FSI·FGS')
  }
  launchOperations = [ordered]@{
    firstHourMonitoringPlanApproved = Confirm-ExternalGate '첫 60분 관측·판정 채널·교대 계획'
    rollbackDrillPassed = Confirm-ExternalGate 'known-good Pages·Worker rollback drill'
    knownGoodRecoveryVerified = Confirm-ExternalGate 'known-good 복구 산출물과 담당자 확인'
    primaryObserver = $primaryObserver
    alternateObserver = $alternateObserver
    references = @(Read-EvidenceReference '첫 60분·rollback drill')
  }
}

New-Item -ItemType Directory -Path (Split-Path -Parent $launchApprovalPath) -Force | Out-Null
$launchApproval | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $launchApprovalPath -Encoding utf8NoBOM
$launchApprovalSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $launchApprovalPath).Hash.ToLowerInvariant()
```

다음 블록은 운영 migration을 시작하기 직전에 실행한다. `HYENI_RELEASE_D1_BOOKMARK`에 문자열을 직접 넣는
구 방식은 값이 실제 bookmark처럼 보여도 release record가 거부한다. 아래 JSON은 기존 파일을 덮어쓰지 않으며,
10분이 지나거나 앱·Worker commit 또는 D1 UUID가 바뀌면 새 파일명으로 다시 캡처해야 한다. 명령은 현재 bookmark만
읽고 aggregate preflight를 실행할 뿐 restore·migration·배포를 실행하지 않는다. 잘못된 로컬 OAuth/account로
연결되지 않도록 `hyeni-3` cwd에서 그 디렉터리의 `.env` 인증을 사용하고, 이 저장소에 설치된 Wrangler CLI와 exact
Worker config를 절대 경로로 고정한다. `.env` 값은 출력하거나 JSON에 넣지 않는다.
Windows에서는 이 preflight를 `wrangler d1 execute --file`로 바꾸지 않는다. `--file`은 D1 import endpoint를
사용해 현재 인증 경로와 달라질 수 있고, `npx wrangler`를 통한 긴 `--command`는 command line 길이 제한을 넘는다.
반드시 아래의 direct Node CLI + `Get-Content -Raw` + `--command` 조합을 그대로 사용한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$wranglerCli = 'C:\Users\TK\Desktop\hyeni-3\node_modules\wrangler\bin\wrangler.js'
$wranglerConfig = 'C:\Users\TK\Desktop\hyeni-3\worker\wrangler.toml'
if (-not (Test-Path -LiteralPath $wranglerCli) -or -not (Test-Path -LiteralPath $wranglerConfig)) {
  throw '승인된 Wrangler CLI 또는 Worker config를 찾을 수 없습니다.'
}

function Write-CreateOnlyUtf8NoBom([string]$Path, [string]$Content) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Content)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
}

$wranglerVersion = (node $wranglerCli --version 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $wranglerVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw 'Wrangler version을 확인하지 못했습니다.'
}

$d1ReadOnlySqlPath = 'C:\Users\TK\Desktop\hyeni-3\worker\ops\release-d1-readonly-preflight.sql'
if (-not (Test-Path -LiteralPath $d1ReadOnlySqlPath)) { throw 'D1 read-only preflight SQL을 찾을 수 없습니다.' }
$d1ReadOnlySql = Get-Content -LiteralPath $d1ReadOnlySqlPath -Raw
$d1ReadOnlySqlSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $d1ReadOnlySqlPath).Hash.ToLowerInvariant()
$d1ReadOnlyStartedAt = (Get-Date).ToUniversalTime().ToString('o')
$d1ReadOnlyJson = (node $wranglerCli d1 execute hyeni-calendar --remote --yes --json "--command=$d1ReadOnlySql" "--config=$wranglerConfig" 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw '운영 D1 read-only preflight가 실패했습니다.' }
$d1ReadOnlyCompletedAt = (Get-Date).ToUniversalTime().ToString('o')

try {
  $d1ReadOnlyResponse = $d1ReadOnlyJson | ConvertFrom-Json -ErrorAction Stop
} catch {
  throw 'D1 read-only preflight 응답이 JSON이 아닙니다.'
}
$d1ReadOnlyBatch = @($d1ReadOnlyResponse)
if ($d1ReadOnlyBatch.Count -ne 1 -or $d1ReadOnlyBatch[0].success -ne $true) {
  throw 'D1 read-only preflight는 성공 batch를 정확히 1개 반환해야 합니다.'
}
$d1ReadOnlyResult = $d1ReadOnlyBatch[0]
$d1ReadOnlyRows = @($d1ReadOnlyResult.results)
if ($d1ReadOnlyRows.Count -ne 1) { throw 'D1 read-only preflight 결과 행은 정확히 1개여야 합니다.' }
$requiredMetaFields = @('changes','changed_db','rows_written')
foreach ($field in $requiredMetaFields) {
  if ($d1ReadOnlyResult.meta.PSObject.Properties.Name -notcontains $field) {
    throw "D1 read-only preflight meta 필드가 없습니다: $field"
  }
}
if ($d1ReadOnlyResult.meta.changed_db -isnot [bool]) { throw 'D1 changed_db meta가 boolean이 아닙니다.' }
if (
  [int64]$d1ReadOnlyResult.meta.changes -ne 0 -or
  [bool]$d1ReadOnlyResult.meta.changed_db -ne $false -or
  [int64]$d1ReadOnlyResult.meta.rows_written -ne 0
) {
  throw 'D1 read-only preflight가 DB를 변경했습니다.'
}

$d1ReadOnlyRow = $d1ReadOnlyRows[0]
$requiredAggregateFields = @(
  'required_objects','present_objects','missing_objects',
  'duplicate_groups','duplicate_rows','rows_removed_by_merge'
)
foreach ($field in $requiredAggregateFields) {
  if ($d1ReadOnlyRow.PSObject.Properties.Name -notcontains $field) {
    throw "D1 read-only preflight 필드가 없습니다: $field"
  }
  if ([int64]$d1ReadOnlyRow.$field -lt 0) { throw "D1 read-only preflight 집계가 음수입니다: $field" }
}
$requiredObjects = [int64]$d1ReadOnlyRow.required_objects
$presentObjects = [int64]$d1ReadOnlyRow.present_objects
$missingObjects = [int64]$d1ReadOnlyRow.missing_objects
$duplicateGroups = [int64]$d1ReadOnlyRow.duplicate_groups
$duplicateRows = [int64]$d1ReadOnlyRow.duplicate_rows
$rowsRemovedByMerge = [int64]$d1ReadOnlyRow.rows_removed_by_merge
if ($requiredObjects -ne $presentObjects + $missingObjects) { throw 'D1 object 집계 불변식이 맞지 않습니다.' }
if ($rowsRemovedByMerge -ne $duplicateRows - $duplicateGroups) { throw 'D1 중복 병합 집계 불변식이 맞지 않습니다.' }
if ($d1ReadOnlyRow.PSObject.Properties.Name -notcontains 'has_ai_friend_limit_source') {
  throw 'D1 read-only preflight에 has_ai_friend_limit_source가 없습니다.'
}
$hasAiFriendLimitSource = [int64]$d1ReadOnlyRow.has_ai_friend_limit_source
if (@(0, 1) -notcontains $hasAiFriendLimitSource) {
  throw 'D1 read-only preflight의 has_ai_friend_limit_source는 0 또는 1이어야 합니다.'
}
if ($d1ReadOnlyRow.PSObject.Properties.Name -notcontains 'has_ai_schedule_limit_source') {
  throw 'D1 read-only preflight에 has_ai_schedule_limit_source가 없습니다.'
}
$hasAiScheduleLimitSource = [int64]$d1ReadOnlyRow.has_ai_schedule_limit_source
if (@(0, 1) -notcontains $hasAiScheduleLimitSource) {
  throw 'D1 read-only preflight의 has_ai_schedule_limit_source는 0 또는 1이어야 합니다.'
}

$d1ReadOnlyResponsePath = Join-Path (Get-Location) ("artifacts/release-evidence/d1-readonly-preflight-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Write-CreateOnlyUtf8NoBom -Path $d1ReadOnlyResponsePath -Content $d1ReadOnlyJson
$d1ReadOnlyResponseSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $d1ReadOnlyResponsePath).Hash.ToLowerInvariant()

$d1CaptureStartedAt = (Get-Date).ToUniversalTime().ToString('o')
$d1BookmarkJson = (node $wranglerCli d1 time-travel info hyeni-calendar "--config=$wranglerConfig" --json 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw '현재 D1 Time Travel bookmark 읽기에 실패했습니다.' }
$d1CaptureCompletedAt = (Get-Date).ToUniversalTime().ToString('o')

try {
  $d1BookmarkResponse = $d1BookmarkJson | ConvertFrom-Json -ErrorAction Stop
} catch {
  throw 'D1 Time Travel bookmark 응답이 JSON이 아닙니다.'
}
$d1Bookmark = [string]$d1BookmarkResponse.bookmark
if ($d1Bookmark -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$') {
  throw 'D1 Time Travel bookmark가 Cloudflare 현재 형식과 다릅니다.'
}

Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$currentAppSha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $currentAppSha -cne $appSha) { throw 'D1 캡처 대상 app SHA가 승인 후보와 다릅니다.' }
$currentWorkerSha = git rev-parse HEAD  # Worker 정본이 같은 저장소라 같은 HEAD를 대조한다
if ($LASTEXITCODE -ne 0 -or $currentWorkerSha -cne $workerSha) { throw 'D1 캡처 대상 Worker SHA가 승인 후보와 다릅니다.' }

Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$d1BookmarkEvidencePath = Join-Path (Get-Location) ("artifacts/release-evidence/d1-time-travel-bookmark-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$d1BookmarkEvidence = [ordered]@{
  schemaVersion = 1
  artifactKind = 'hyeni-d1-time-travel-bookmark'
  capturedAt = $d1CaptureCompletedAt
  captureStartedAt = $d1CaptureStartedAt
  captureCompletedAt = $d1CaptureCompletedAt
  appSourceCommit = $appSha
  workerSourceCommit = $workerSha
  database = [ordered]@{
    binding = 'DB'
    name = 'hyeni-calendar'
    id = 'c08f9b89-3418-443e-9946-e6b2c68cfc4c'
  }
  request = [ordered]@{
    operation = 'd1-time-travel-info'
    mode = 'current'
    responseFormat = 'json'
    wranglerVersion = $wranglerVersion
    executionCwd = 'hyeni-3'
    configPath = 'worker/wrangler.toml'
    cliPath = 'node_modules/wrangler/bin/wrangler.js'
  }
  readOnlyPreflight = [ordered]@{
    capturedAt = $d1ReadOnlyCompletedAt
    sqlPath = 'worker/ops/release-d1-readonly-preflight.sql'
    sqlSha256 = $d1ReadOnlySqlSha256
    responsePath = $d1ReadOnlyResponsePath.Replace((Get-Location).Path + [IO.Path]::DirectorySeparatorChar, '').Replace('\', '/')
    responseSha256 = $d1ReadOnlyResponseSha256
    resultRowCount = 1
    meta = [ordered]@{
      changes = [int64]$d1ReadOnlyResult.meta.changes
      changedDb = [bool]$d1ReadOnlyResult.meta.changed_db
      rowsWritten = [int64]$d1ReadOnlyResult.meta.rows_written
    }
    summary = [ordered]@{
      requiredObjects = $requiredObjects
      presentObjects = $presentObjects
      missingObjects = $missingObjects
      duplicateGroups = $duplicateGroups
      duplicateRows = $duplicateRows
      rowsRemovedByMerge = $rowsRemovedByMerge
      hasAiScheduleLimitSource = $hasAiScheduleLimitSource
    }
  }
  bookmark = $d1Bookmark
}
Write-CreateOnlyUtf8NoBom -Path $d1BookmarkEvidencePath -Content ($d1BookmarkEvidence | ConvertTo-Json -Depth 6)
$d1BookmarkEvidenceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $d1BookmarkEvidencePath).Hash.ToLowerInvariant()
```

2026-08-02 12:02 KST 읽기 전용 실측은 required/present/missing object `25/2/23`, 중복 group/row/merge 제거 대상
`1/6/5`, `has_ai_friend_limit_source=0`, `has_ai_schedule_limit_source=0`이었다. 기계 증거는
`artifacts/release-evidence/d1-readonly-preflight-20260802-120214.json`이며, 과거 10:46 bookmark는 current final release
record에 연결하지 않는다. 이는 해당 시각의 익명 진단값일 뿐이며, 새 bookmark와 preflight 성공은 migration 쓰기 승인이나
`READY_FOR_HUMAN_GO_REVIEW`를 뜻하지 않는다. 실제 실행 직전 값이 달라지면 새 결과를 근거로 운영 책임자가 다시 판정한다.
release record는 보존한 원본 응답도 다시 읽어 단일 결과 행과 meta changes=0·changed_db=false·rows_written=0,
익명 summary, `has_ai_schedule_limit_source=1`, SQL·응답 SHA-256이 모두 일치할 때만 이 증거를 인정한다.
기존 `premium_funnel_events` 테이블에서 `has_ai_friend_limit_source=0`이면
`worker/db/premium-funnel-ai-friend-limit.sql`을 정확히 1회 적용한다. 이미 `has_ai_friend_limit_source=1`이면
재실행하지 않으며, 최종 read-only preflight에서 `has_ai_friend_limit_source=1` 확인이 필수이고 아니면 `HOLD`한다.
기존 `premium_funnel_events` 테이블에서 `has_ai_schedule_limit_source=0`이면
`worker/db/premium-funnel-ai-schedule-limit.sql`을 정확히 1회 적용한다. 이미 `has_ai_schedule_limit_source=1`이면
재실행하지 않으며, 최종 read-only preflight에서 `has_ai_schedule_limit_source=1` 확인은 필수이고 아니면 `HOLD`한다.
사전 캡처의 값이 `0`이어도 위 코드는 변경 전 복구 bookmark와 진단 응답을 먼저 보존한다. 그 증거로 최종 승인하지 않고,
승인된 변경 창에서 forward migration과 readback을 마친 뒤 이 preflight·bookmark 캡처 전체를 다시 실행한다.
최종 release record에는 재캡처한 `1` 증거만 연결하며, 사전 `0` 증거는 복구 기준으로 별도 보존한다.

아래 블록은 4절의 known-good 실제 보관본·rollback target 확인과 migration 후 `1` 재캡처까지 끝난 뒤 실행한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
if ($hasAiFriendLimitSource -ne 1) {
  throw '사전 복구 bookmark는 보존됐지만 final release record에는 has_ai_friend_limit_source=1 재캡처가 필요합니다.'
}
if ($hasAiScheduleLimitSource -ne 1) {
  throw '사전 복구 bookmark는 보존됐지만 final release record에는 has_ai_schedule_limit_source=1 재캡처가 필요합니다.'
}

$env:HYENI_RELEASE_APP_CI_RUN_ID = $appCiRunId
$env:HYENI_RELEASE_APP_CI_SOURCE_SHA = $appSha
$env:HYENI_RELEASE_WORKER_CI_RUN_ID = $workerCiRunId
$env:HYENI_RELEASE_WORKER_CI_SOURCE_SHA = $workerSha
$env:HYENI_RELEASE_PAGES_DIST_PATH = $pagesDistPath
$env:HYENI_RELEASE_PAGES_ARTIFACT_NAME = $pagesArtifactName
$env:HYENI_RELEASE_PAGES_PROVENANCE_PATH = $pagesProvenancePath
$env:HYENI_RELEASE_PAGES_PROVENANCE_SHA256 = $pagesProvenanceSha256
$env:HYENI_RELEASE_AAB_PATH = $aabPath
$env:HYENI_RELEASE_AAB_SOURCE_SHA = $appSha
$env:HYENI_RELEASE_AAB_EVIDENCE_PATH = $aabEvidencePath
$env:HYENI_RELEASE_AAB_EVIDENCE_SHA256 = $aabEvidenceSha256
$env:HYENI_RELEASE_UPLOAD_CERTIFICATE_SHA256 = $uploadCertificateSha256
$env:HYENI_RELEASE_CLIENT_INVENTORY_PATH = $clientInventoryPath
$env:HYENI_RELEASE_CLIENT_INVENTORY_SHA256 = $clientInventorySha256
$env:HYENI_RELEASE_LAUNCH_APPROVAL_PATH = $launchApprovalPath
$env:HYENI_RELEASE_LAUNCH_APPROVAL_SHA256 = $launchApprovalSha256
$env:HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_PATH = $d1BookmarkEvidencePath
$env:HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256 = $d1BookmarkEvidenceSha256
$env:HYENI_RELEASE_PAGES_DEPLOYMENT_ID = $candidatePagesDeploymentId
$env:HYENI_RELEASE_PAGES_SOURCE_SHA = $appSha
$env:HYENI_RELEASE_WORKER_VERSION_ID = $candidateWorkerVersionId
$env:HYENI_RELEASE_WORKER_SOURCE_SHA = $workerSha
$env:HYENI_KNOWN_GOOD_PAGES_DIST_SHA256 = Read-Host 'known-good Pages dist tree SHA-256'
$env:HYENI_KNOWN_GOOD_PAGES_ARCHIVE_PATH = Read-Host 'known-good Pages dist archive 절대 경로'
$env:HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256 = Read-Host 'known-good Pages dist archive SHA-256'
$env:HYENI_KNOWN_GOOD_WORKER_VERSION_ID = Read-Host 'known-good Worker version ID'
$env:HYENI_RELEASE_OBSERVATION_OWNER = $primaryObserver

$releaseStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$releaseRecordPath = "artifacts/release-records/$releaseStamp.json"
npm run release:record -- --out $releaseRecordPath
if ($LASTEXITCODE -eq 2) { throw 'release record 판정이 HOLD입니다.' }
if ($LASTEXITCODE -ne 0) { throw 'release record 생성에 실패했습니다.' }
```

`assessment.verdict`가 `READY_FOR_HUMAN_GO_REVIEW`인지 확인한 뒤 파일을 변경 불가능한 출시 증거
저장소에 복사한다. `humanApprovalRequired`는 반드시 `true`여야 한다. 이미 생성된 record를 편집해
누락 증거를 채우지 말고, 증거를 확보한 뒤 새 파일명으로 다시 생성한다.

release record는 D1 bookmark evidence의 expected SHA-256과 실제 파일을 대조하고, strict schema 밖 필드,
`current`가 아닌 timestamp 요청, Wrangler 3.4.0 미만, Cloudflare 형식이 아닌 bookmark, 2분 초과 캡처,
10분 초과 stale evidence, `hyeni-3` cwd·승인 Wrangler CLI·exact Worker config 불일치, 현재 app·Worker SHA 또는
`wrangler.toml` DB 식별 불일치를 모두 `HOLD`한다. `hyeni-3/.env`의 D1 API token 값은 출력하거나 evidence에 넣지 않는다.

이 런북은 `wrangler d1 time-travel restore`를 정상 롤백 수단으로 사용하지 않는다. 사용자 쓰기를 다시
연 뒤 전체 DB를 과거로 되돌리면 정상 일정·위치·메모·결제까지 소실된다.

## 4. known-good 복구 준비

### Pages

- 직전 production deployment ID와 앱 SHA를 기록한다.
- 동일 배포의 실제 `dist` 디렉터리를 제한된 보관소에 보존하고 release record의 tree SHA-256과 대조한다.
- 보관본 ZIP은 `index.html`, `_headers`, `app-version.json`, `manifest.webmanifest`, `sw.js`,
  `.well-known/assetlinks.json`, `assets/`의 실제 파일을 함께 포함해야 한다. ZIP64·암호화·symbolic link·특수 파일은
  허용하지 않으며 배포 파일은 archive 루트 또는 하나의 공통 최상위 디렉터리 아래에 있어야 한다.
- 보관본으로 preview branch 배포를 연습하고 route·PWA precache·법적 링크를 확인한다. preview 성공은
  production 롤백 자체의 증거가 아니므로 Dashboard의 production rollback target도 별도로 확인한다.

Pages 명령은 `hyeni-3/.env`가 없는 임시 디렉터리에서만 실행한다. 프로젝트 `.env`의 Workers/D1 전용
token이 Wrangler OAuth를 덮어쓰는 것을 막기 위한 규칙이다.

```powershell
$knownGoodPagesDistPath = Read-Host 'known-good dist의 절대 경로'
if (-not [System.IO.Path]::IsPathFullyQualified($knownGoodPagesDistPath)) { throw '절대 경로가 필요합니다.' }
if (-not (Test-Path -LiteralPath $knownGoodPagesDistPath -PathType Container)) { throw 'known-good dist를 찾지 못했습니다.' }
$knownGoodAppSha = Read-Host 'known-good app commit SHA'
if ($knownGoodAppSha -notmatch '^[0-9a-fA-F]{40}$') { throw '올바른 app commit SHA가 아닙니다.' }

$pagesOpsDir = Join-Path ([System.IO.Path]::GetTempPath()) "hyeni-pages-rollback-drill-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $pagesOpsDir | Out-Null
Push-Location -LiteralPath $pagesOpsDir
try {
  npx wrangler pages deploy $knownGoodPagesDistPath --project-name=hyeni-calendar --branch=rollback-drill --commit-hash=$knownGoodAppSha --commit-message="known-good rollback drill $knownGoodAppSha" --commit-dirty=false
  if ($LASTEXITCODE -ne 0) { throw 'Pages known-good preview rehearsal에 실패했습니다.' }
} finally {
  Pop-Location
}
```

### Worker

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
npx wrangler deployments list --name hyeni-calendar-api --json
npx wrangler deploy --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Worker dry-run에 실패했습니다.' }
```

known-good version이 목록에 없거나 새 binding·Durable Object lifecycle·D1 구조와 호환되지 않으면 다른
이전 버전을 임의 선택하지 않는다. 검토된 forward fix와 새 복구 후보를 준비할 때까지 `HOLD`다.

## 5. 승인된 출시 순서

`zero_public_installs` inventory가 검증된 초기 출시의 순서는
**D1 migration·readback → Worker → Pages → Play 단계적 rollout**이다. 공개 설치 0 증거가 없으면
**Play v1.3.0(5) 대상 계정·트랙 설치 가능 확인 → D1 migration·readback → Worker → Pages
minimumSupportedVersion 1.3.0 적용 → Play rollout 확대** 순서다. 기존 사용자가 Play에서 1.3.0을 받을 수
있기 전에 Pages가 1.2.0을 차단해서는 안 된다. 각 단계가 통과하기 전에 다음 단계로 넘어가지 않는다.

### 보안 프로토콜 동시 전환 게이트

이번 후보는 access JWT를 URL에서 제거한다. 새 앱은 `POST /api/realtime/ticket`으로 받은 45초·1회용
ticket만 WebSocket URL에 넣고, 비공개 사진·첨부는 `Authorization` fetch 뒤 로컬 blob URL로 표시한다.
새 Worker는 구 앱의 `/realtime?family_id={familyId}&token={accessJwt}`와 비공개 객체 `?token=` 요청을 의도적으로 거부한다.
반대로 새 앱은 ticket endpoint가 없는 구 Worker와 realtime 연결을 만들 수 없다. 따라서 아래 조건을
모두 만족하지 못하면 Worker를 배포하지 않고 `HOLD`한다.

1. 새 Worker version, 같은 계약의 Pages `dist`, 최신 Android 후보 APK/AAB가 모두 동일 release record에 고정돼 있다.
2. v1.2.0 A17·razr 결과는 이전 후보의 역사 증거일 뿐 v1.3.0 완료 증거가 아니다. 이번 최종 기기 검증은
   A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이만 승인 범위이며 S25는 완전 무조작한다.
   설치·실행·로그·세션 조회를 포함한 어떤 adb 접근도 하지 않는다.
3. A17과 razr의 기존 세션을 보존한 `adb install -r`만 수행하고 부모 역할은 A17, 아이 역할은 razr에서
   읽기 중심으로 확인한다. 실제 로그아웃·역할 전환·재페어링·refresh token 접근과 SOS·울리기·주변 소리·
   결제처럼 상태를 바꾸는 동작은 실행하지 않는다.
4. Worker 배포 직후 health·ticket 발급·ticket 1회 소비를 확인하고, 즉시 Pages를 배포한 뒤 승인 범위의
   역할별 realtime 재연결과 비공개 이미지 조회를 확인한다. 실제 SOS·울리기·주변 소리를 실행하지 않는다.
5. 새 Pages나 Android 후보가 준비되지 않았거나 ticket/이미지 smoke가 실패하면 Play rollout을 시작하지 않는다.
6. Worker만 구버전으로 되돌리면 새 앱의 realtime이 끊기고, Pages만 되돌리면 구 앱이 새 Worker에서 끊긴다.
   rollback은 검증된 Worker와 Pages 쌍으로 수행한다. 이미 배포된 Android가 새 계약이면 호환되는 forward fix를
   우선하며, 앱을 임의 downgrade하거나 세션을 지우지 않는다.

1. 운영 책임자가 manifest의 현재 스키마 분기를 다시 읽고 필요한 migration만 정확히 한 번 적용한다. 기존
   `premium_funnel_events` 테이블에서 `has_ai_friend_limit_source=0`이면
   `worker/db/premium-funnel-ai-friend-limit.sql`을 정확히 1회 적용하고, 값이 이미 `1`이면 재실행하지 않는다.
   이어서 `has_ai_schedule_limit_source=0`이면 `worker/db/premium-funnel-ai-schedule-limit.sql`을 정확히 1회 적용하고,
   값이 이미 `1`이면 재실행하지 않는다.
2. 각 테이블·컬럼·인덱스·불변식을 readback한다. 최종 read-only preflight의
   `has_ai_friend_limit_source=1`·`has_ai_schedule_limit_source=1` 확인이 필수이며, 실패하면 사용자 쓰기를 열지 않고 `HOLD`한다.
3. 3절의 read-only preflight와 bookmark를 전체 재캡처하고 두 source flag가 모두 `1`인 새 evidence로
   release record를 다시 생성한다. 변경 전 `0` bookmark를 덮어쓰거나 최종 승인 증거로 바꾸지 않는다.
4. Worker 전체 테스트와 `npx tsc --noEmit`, `npx wrangler deploy --dry-run`을 동일 Worker SHA에서 재확인한다.
5. release record에 고정한 Worker candidate version ID를 새 build 없이 정확히 100% 배포한다.
6. 공개 health와 인증된 데모 read-only smoke가 통과한 뒤 동일 앱 SHA의 `dist`를 Pages에 배포한다.
7. Pages production deployment ID, dist tree SHA-256, commit hash를 기록하고 새 문서에서 PWA를 검증한다.
8. `zero_public_installs`가 아니면 이 단계 전에 이미 확인한 v1.3.0 설치 가용성이 계속 유효한지 다시 확인한다.
9. Play 내부·비공개 테스트 증거를 확인한 뒤 소규모 단계적 rollout만 시작한다.

Worker는 release record에 기록한 후보 version을 그대로 배포한다. 여기서 `wrangler deploy`를 다시 실행하면
검증하지 않은 새 version ID가 생기므로 사용하지 않는다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
$candidateWorkerVersionId = $env:HYENI_RELEASE_WORKER_VERSION_ID
if ($candidateWorkerVersionId -notmatch '^[0-9a-fA-F-]{20,64}$') { throw 'release record의 Worker version ID가 필요합니다.' }
npx wrangler versions deploy "$candidateWorkerVersionId@100%" --name hyeni-calendar-api --message="혜니캘린더 승인 후보 100% 배포 $candidateWorkerVersionId" --yes
if ($LASTEXITCODE -ne 0) { throw 'Worker 배포에 실패했습니다.' }
npx wrangler deployments list --name hyeni-calendar-api --json
```

Pages production 배포는 임시 디렉터리에서 수행한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$appSha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $appSha -notmatch '^[0-9a-fA-F]{40}$') { throw '앱 SHA를 확인하지 못했습니다.' }
$pagesDistPath = (Resolve-Path -LiteralPath $env:HYENI_RELEASE_PAGES_DIST_PATH).Path
$pagesOpsDir = Join-Path ([System.IO.Path]::GetTempPath()) "hyeni-pages-production-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $pagesOpsDir | Out-Null
Push-Location -LiteralPath $pagesOpsDir
try {
  npx wrangler pages deploy $pagesDistPath --project-name=hyeni-calendar --branch=main --commit-hash=$appSha --commit-message="혜니캘린더 출시 $appSha" --commit-dirty=false
  if ($LASTEXITCODE -ne 0) { throw 'Pages 배포에 실패했습니다.' }
  npx wrangler pages deployment list --project-name=hyeni-calendar --environment=production --json
} finally {
  Pop-Location
}
```

Pages 배포 전에 기존 production PWA를 열린 탭으로 유지하고 그 탭의 현재 entry script URL을
`sessionStorage.hyeniReleaseBeforeEntry`에 저장한다. 배포 뒤 수동 새로고침을 하지 않은 상태에서 DevTools
Console로 `navigator.serviceWorker.getRegistration().then((registration) => registration.update())`를 실행한다.
`registerType: prompt`의 새 Service Worker가 `onNeedRefresh`에서 안전 업데이트 큐에 들어간 뒤, 결제·AI 크레딧
대사·주변소리·미저장 편집이 없을 때만 `SKIP_WAITING`으로 controlling 상태가 되고 문서가 자동으로 한 번
reload되는지 확인한다. 중요 작업 중에는 reload가 발생하지 않고, 작업 종료 직후 보류한 활성화와 reload가 정확히
한 번 이어져야 한다. reload 뒤 entry script URL이 저장값과 달라졌는지,
`performance.getEntriesByType('navigation')[0].type`이 `reload`인지 확인한다. 새 route 이동·Free/Premium 화면·
오프라인 재진입에서 구 chunk 404와 Console error가 0건이어야 한다. 안전한 유휴 상태에서도 자동 reload되지 않거나,
중요 작업 중 reload되거나, 구·신 chunk가 섞이면 Pages 단계를 `HOLD`하고 rollout을 확대하지 않는다.

배포 도중 secret 값을 바꾸거나 누락 secret을 즉석에서 추측해 넣지 않는다. 필수 설정이 빠져 결제가
`503`으로 fail-closed하면 권리를 강제로 열지 않고 출시 확대를 `HOLD`한다.

Pages production 배포가 끝나면 `HYENI_RELEASE_PAGES_DEPLOYMENT_ID`를 방금 확인한 production ID로
교체하고 `release:record`를 새 파일명으로 다시 실행한다. Worker는 사전 record와 실제 배포의 version ID가
동일해야 한다. 사전 record를 덮어쓰거나 편집하지 않는다.

## 6. 첫 60분 관측

배포 직전 10분을 baseline으로 저장하고 새 Worker version ID만 필터링해 관측한다. `/api/health`는 핵심
D1 스키마와 7단계 출시 migration의 테이블·인덱스·trigger·필수 컬럼을 확인하지만, 인증 세션·외부 결제사·
푸시 표시 ACK·실제 가족 격리까지 검증하지는 않으므로 단독 성공을 출시 성공으로 판정하지 않는다.

| 시각 | 필수 확인 | 판정 |
|---|---|---|
| T-10 | health, Pages, Worker 5xx, 알림·memo outbox·RTDN·환불 큐 baseline | baseline 미확보면 `HOLD` |
| T+0 | 실제 Worker version ID, Pages deployment ID, Play rollout 상태 기록 | ID 불일치면 `ROLLBACK` |
| T+5 | 공개 health·Pages·법적 페이지·app-version, 새 Worker error tail | 핵심 endpoint 5xx면 확대 중단 |
| T+15 | 데모 부모·아이 로그인 유지, 가족 격리, 일정·메모·위치 read, Free/Premium 권리 read | 세션·권리·격리 오류면 `ROLLBACK` |
| T+30 | pending·memo outbox·RTDN·refund aggregate와 crash/ANR | 두 번 연속 악화면 `ROLLBACK` 검토 |
| T+45 | 같은 항목 재확인, UGC·feedback 큐 담당자 인수 확인 | 무담당 큐면 `HOLD` |
| T+60 | 모든 증거 저장, 주·대체 담당자 공동 판정 | 기준 충족 때만 단계 확대 |

Android 후보의 crash·native crash·ANR은 A17 부모와 razr 아이만 대상으로 `ApplicationExitInfo`의
reason code 4·5·6을 집계한다. 원문 description·trace·serial은 저장하지 않는다. 최종 APK 설치 완료 시각을
ISO 8601로 넣고, 결과 JSON의 두 기기 `totalCrashOrAnr`가 모두 0인지 T+15·T+30·T+60에 다시 확인한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$candidateInstalledAt = Read-Host 'A17과 razr의 최종 후보 설치 완료 시각(예: 2026-08-02T18:30:00+09:00)'
node scripts/android-exit-info-summary.mjs --since=$candidateInstalledAt
if ($LASTEXITCODE -ne 0) { throw 'Android crash/ANR 집계가 실패했습니다.' }
```

이 기기 집계는 설치 직후 후보의 국소 증거다. Play 내부 테스트 이후의 실제 사용자 지표는 Play Console
`Android vitals → Crashes and ANRs`에서 후보 versionCode와 기간을 고정해 별도로 보존한다.

공개 probe는 다음과 같이 실행한다.

```powershell
$health = Invoke-RestMethod -Method Get -Uri 'https://hyeni-calendar-api.tkisdroid.workers.dev/api/health'
if ($health.ok -ne $true) { throw 'Worker health가 실패했습니다.' }

$pages = Invoke-WebRequest -Method Get -Uri 'https://hyeni-calendar.pages.dev/' -MaximumRedirection 0
if ($pages.StatusCode -ne 200) { throw 'Pages root가 200이 아닙니다.' }

$versionPolicy = Invoke-RestMethod -Method Get -Uri 'https://hyeni-calendar.pages.dev/app-version.json'
if ($versionPolicy.latestVersion -ne '1.3.0' -or $versionPolicy.minimumSupportedVersion -ne '1.3.0') { throw '앱 버전 정책이 출시 후보와 다릅니다.' }

foreach ($legalUrl in @(
  'https://hyeni-calendar-api.tkisdroid.workers.dev/privacy',
  'https://hyeni-calendar-api.tkisdroid.workers.dev/terms',
  'https://hyeni-calendar-api.tkisdroid.workers.dev/data-deletion'
)) {
  $legal = Invoke-WebRequest -Method Get -Uri $legalUrl -MaximumRedirection 0
  if ($legal.StatusCode -ne 200) { throw "법적 페이지 확인 실패: $legalUrl" }
}
```

새 Worker의 오류 tail은 별도 터미널에서 실행한다. URL·헤더·본문·토큰을 복사해 incident 기록에 붙이지 않는다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
$newWorkerVersionId = Read-Host '이번 배포 Worker version ID'
if ($newWorkerVersionId -notmatch '^[0-9a-fA-F-]{20,64}$') { throw '올바른 Worker version ID가 아닙니다.' }
npx wrangler tail hyeni-calendar-api --format pretty --status error --version-id $newWorkerVersionId
```

운영 큐는 Worker 처리 코드와 같은 status·lease·retry 조건을 쓰는 단일 read-only SQL로 저장한다.
`pending_notifications`, `memo_notification_outbox`, `google_play_rtdn_events`·voided purchase RTDN,
웹 구독·환불·AI 크레딧 대사 큐에서 DB 시각과 고정 count만 반환한다. 원문·사용자·가족·아이·주문·token은
결과로 반환하거나 증거에 저장하지 않는다. 아래 함수와 `$queueEvidenceDirectory`는 첫 60분 동안 같은 운영 터미널에서 유지한다.
핵심 필드는 `urgent_over_2m`, `memo_outbox_due`, `rtdn_retryable`이며 나머지는 구독·환불·AI 크레딧
처리 코드의 실제 due 조건별 고정 필드다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
$queueEvidenceDirectory = Join-Path -Path '..\artifacts' -ChildPath ("first-hour-queues-" + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $queueEvidenceDirectory | Out-Null

function Save-HyeniQueueSnapshot {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('T-10', 'T+30', 'T+45', 'T+60')]
    [string]$Checkpoint,
    [Parameter(Mandatory = $true)]
    [string]$FileName
  )
  $queueAggregate = npx wrangler d1 execute hyeni-calendar --remote --yes --json --file=ops/first-hour-queue-snapshot.sql
  if ($LASTEXITCODE -ne 0) { throw "$Checkpoint 운영 큐 집계가 실패했습니다." }
  $queueSnapshotPath = Join-Path -Path $queueEvidenceDirectory -ChildPath $FileName
  $queueCaptureResult = $queueAggregate | node .\scripts\capture-first-hour-queue-snapshot.mjs --checkpoint=$Checkpoint --out=$queueSnapshotPath
  if ($LASTEXITCODE -ne 0) { throw "$Checkpoint 운영 큐 스냅샷 저장이 실패했습니다." }
  return $queueSnapshotPath
}

$queueTMinus10 = Save-HyeniQueueSnapshot -Checkpoint 'T-10' -FileName 't-minus-10.json'
```

T+30·T+45·T+60에는 각각 다음 명령을 실행한다. T+45부터는 시간순 스냅샷을 자동 비교한다.
결과 파일은 create-only라 같은 출시 증거를 덮어쓰지 않는다.

```powershell
$queueTPlus30 = Save-HyeniQueueSnapshot -Checkpoint 'T+30' -FileName 't-plus-30.json'

$queueTPlus45 = Save-HyeniQueueSnapshot -Checkpoint 'T+45' -FileName 't-plus-45.json'
$queueTrendTPlus45 = Join-Path -Path $queueEvidenceDirectory -ChildPath 'trend-t-plus-45.json'
node .\scripts\check-first-hour-queue-trend.mjs $queueTMinus10 $queueTPlus30 $queueTPlus45 --out=$queueTrendTPlus45
$queueTrendExitCode = $LASTEXITCODE
if ($queueTrendExitCode -eq 1) { throw '운영 큐가 두 구간 연속 증가했습니다. 신규 rollout을 중단합니다.' }
if ($queueTrendExitCode -eq 2) { throw '운영 큐 판정이 불충분합니다. 출시 확대를 HOLD합니다.' }

$queueTPlus60 = Save-HyeniQueueSnapshot -Checkpoint 'T+60' -FileName 't-plus-60.json'
$queueTrendTPlus60 = Join-Path -Path $queueEvidenceDirectory -ChildPath 'trend-t-plus-60.json'
node .\scripts\check-first-hour-queue-trend.mjs $queueTMinus10 $queueTPlus30 $queueTPlus45 $queueTPlus60 --out=$queueTrendTPlus60
$queueTrendExitCode = $LASTEXITCODE
if ($queueTrendExitCode -eq 1) { throw '운영 큐가 두 구간 연속 증가했습니다. 신규 rollout을 중단합니다.' }
if ($queueTrendExitCode -eq 2) { throw '운영 큐 판정이 불충분합니다. 출시 확대를 HOLD합니다.' }
```

자동 판정은 유효한 스냅샷 3개 이상에서 같은 큐가 1→2와 2→3 두 구간 연속 엄격히 증가할 때만
`ROLLBACK_REQUIRED`(exit 1)를 반환한다. 단일 증가·정체·감소는 `HEALTHY`(exit 0)이고, 파일 누락·형식 오류·
checkpoint/DB 시각 역전·20분 초과 stale·2분 초과 미래 시각·90분 초과 관측 폭은 `INCONCLUSIVE`(exit 2)다.
`HEALTHY`는 큐 추세만 통과했다는 뜻이며 사람의 `GO`를 대체하지 않는다. 상세 계약은
`C:\Users\TK\Desktop\hyeni-3\worker\ops\first-hour-queue-trend.md`를 따른다.

AI·UGC 접수 담당자 인수와 환불 금융 불변식은 자동 큐 추세와 별도로 확인한다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT type, status, COUNT(*) AS report_count FROM user_feedback WHERE type IN ('ai_content_report','memo_content_report','feature_feedback') AND datetime(substr(created_at,1,19))>=datetime('now','-60 minutes') GROUP BY type,status ORDER BY type,status;"

npx wrangler d1 execute hyeni-calendar --remote --json --file=ops/web-billing-refund-monitor.sql
```

모니터 결과에 원시 주문번호, billing key, payment key, purchase token을 추가하지 않는다.

## 7. 중단·롤백 기준

다음 항목은 건수와 무관하게 즉시 신규 rollout을 멈추고 `ROLLBACK`한다.

- 다른 가족·다른 아이의 일정, 메모, 위치, 사진, 알림 또는 권리가 보인다.
- 부모·아이 기존 세션이 새 배포 뒤 풀리거나 refresh 회전·역할·family 정본이 갈라진다.
- entitlement 조회 실패, 결제 검증 실패, 환불 상태에서 Premium 또는 AI 크레딧이 fail-open된다.
- SOS·긴급·위험 알림이 유실되거나 일반 알림이 긴급으로 잘못 승격된다.
- 주변 소리가 서버 승인 증표·정확한 가족/대상/nonce 없이 시작되거나 1분 상한·아이 표시·감사 기록을 어긴다.
- access·refresh·purchase/order token 또는 비공개 객체 capability가 URL·로그·응답에 노출된다.
- 새 Android 빌드가 부모 또는 아이 핵심 진입에서 반복 crash·ANR을 만든다.

다음 항목은 즉시 단계 확대를 `HOLD`하고 5분 내 원인을 분리한다. 새 배포가 원인이고 다음 관측에서도
회복되지 않으면 영향 계층을 롤백한다.

- `/api/health`, Pages root, 법적 페이지 중 하나가 연속 두 번 실패한다.
- 동일 새 Worker version의 5xx가 rolling 5분에 5건 이상이며 해당 구간 요청의 1%를 넘는다.
- `check-first-hour-queue-trend.mjs`가 같은 큐의 두 구간 연속 증가를 `ROLLBACK_REQUIRED`로 판정한다.
- 실제 활성 데모 부모·아이에서 동일 read API가 세 번 연속 실패한다.
- 결제·퍼널·추천 필수 secret 또는 migration 누락으로 `503 configured:false`가 발생한다.
- AI·UGC `new` 큐를 인수할 담당자가 없거나 이의 제기 메일을 수신할 수 없다.

단순 사용자 기기 offline 때문에 남은 pending과 새 배포 회귀를 구분한다. baseline보다 이미 크던 backlog를
새 배포 탓으로 단정하지 않지만, 안전 알림의 실제 표시 ACK가 확인되지 않으면 전달 성공으로 기록하지 않는다.

## 8. 롤백 실행

### Worker만 문제인 경우

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
$knownGoodWorkerVersionId = Read-Host 'release record의 known-good Worker version ID'
if ($knownGoodWorkerVersionId -notmatch '^[0-9a-fA-F-]{20,64}$') { throw '올바른 Worker version ID가 아닙니다.' }
npx wrangler rollback $knownGoodWorkerVersionId --name hyeni-calendar-api --message="출시 이상 징후로 검증된 known-good 복구" --yes
if ($LASTEXITCODE -ne 0) { throw 'Worker 롤백에 실패했습니다.' }
npx wrangler deployments list --name hyeni-calendar-api --json
```

Worker 롤백 뒤 D1 table·column·index, R2 object, KV, Durable Object를 삭제하거나 과거 상태로 되돌리지 않는다.
known-good 코드가 additive schema와 호환되지 않으면 이 명령을 실행하지 않고 검토된 forward fix를 배포한다.

### Pages만 문제인 경우

1. Cloudflare Dashboard의 `Workers & Pages → hyeni-calendar → Deployments`에서 release record에 적힌
   직전 production deployment ID와 앱 SHA를 대조한다.
2. 그 행의 `Rollback to this deployment`를 선택하고 production URL의 deployment ID를 다시 기록한다.
3. Dashboard 대상이 없거나 실패하면 실제 보관된 known-good `dist`를 4절과 같은 임시 디렉터리 방식으로
   `--branch=main`에 재배포한다. 해시만 있고 파일이 없으면 재배포하지 않는다.
4. 새 문서에서 PWA precache, `app-version.json`, 주요 route를 확인한다. 기존 브라우저의 구·신 chunk 혼합
   404도 확인한다.

### 계약 불일치인 경우

앱과 Worker가 함께 바뀐 계약이면 각각 독립적으로 임의 버전을 고르지 않는다. release record에 함께 검증된
known-good 앱 SHA·Pages deployment·Worker version 조합으로 복구한다. D1은 additive 상태로 유지한다.

### Android인 경우

Play rollout을 즉시 중지한다. 이미 배포한 versionCode를 재사용하거나 기존 AAB를 덮어쓰지 않는다. 수정 후
더 높은 versionCode의 새 서명 AAB를 만들고 전체 release gate를 다시 통과한다. 서버·Pages가 정상이라면
Android 문제 때문에 정상 서버 데이터를 과거로 복원하지 않는다.

## 9. 종료 기록

T+60에는 다음을 한 변경 기록에 남긴다.

- 앱·Worker SHA, lockfile hash, CI run ID
- AAB SHA-256·versionCode·서명·16KB evidence
- exact app·Worker SHA·현재 DB UUID에 결박된 D1 bookmark machine evidence 파일 SHA-256과 실제 적용한 migration·readback
- 새/known-good Worker version ID와 Pages deployment ID·dist tree SHA-256
- T-10, T+5, T+15, T+30, T+45, T+60 집계와 crash/ANR 화면
- 발생한 incident, 영향 범위, 롤백 또는 유지 근거
- 주·대체 관측 담당자와 최종 `GO`, `HOLD`, `ROLLBACK` 서명 시각

관측 자료에 사용자 이름, 가족 ID, 좌표, 메모·AI 원문, 이메일·전화번호, 인증·결제 token을 넣지 않는다.
오류가 없었다는 결론은 실제로 확인한 계층과 60분 범위로 한정한다.
