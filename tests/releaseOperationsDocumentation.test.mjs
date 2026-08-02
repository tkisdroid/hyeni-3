import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [releaseRunbook, moderationRunbook, releaseRecord, contentSafetyEndpoint] = await Promise.all([
  read("docs/release/release-day-rollback-runbook.md"),
  read("docs/ugc-moderation-operations.md"),
  read("scripts/create-release-record.mjs"),
  read("src/lib/api/endpoints/contentSafety.ts"),
]);

test("출시 런북은 외부 증거 없는 자동 GO를 금지하고 현재 release record 증거를 모두 요구한다", () => {
  assert.match(releaseRunbook, /기본 판정:\s*\*\*HOLD\*\*/);
  assert.match(releaseRunbook, /READY_FOR_HUMAN_GO_REVIEW/);
  assert.match(releaseRunbook, /humanApprovalRequired[^\n]*true/);
  assert.match(releaseRunbook, /CI 성공[^\n]*사람의 `GO`를 대체하지 않는다/);
  assert.match(releaseRunbook, /월 4,900원·연 39,000원/);

  const evidenceVariables = [
    "HYENI_RELEASE_APP_CI_RUN_ID",
    "HYENI_RELEASE_APP_CI_SOURCE_SHA",
    "HYENI_RELEASE_WORKER_CI_RUN_ID",
    "HYENI_RELEASE_WORKER_CI_SOURCE_SHA",
    "HYENI_RELEASE_PAGES_DIST_PATH",
    "HYENI_RELEASE_PAGES_ARTIFACT_NAME",
    "HYENI_RELEASE_PAGES_PROVENANCE_PATH",
    "HYENI_RELEASE_PAGES_PROVENANCE_SHA256",
    "HYENI_RELEASE_AAB_PATH",
    "HYENI_RELEASE_AAB_SOURCE_SHA",
    "HYENI_RELEASE_AAB_EVIDENCE_PATH",
    "HYENI_RELEASE_AAB_EVIDENCE_SHA256",
    "HYENI_RELEASE_UPLOAD_CERTIFICATE_SHA256",
    "HYENI_RELEASE_CLIENT_INVENTORY_PATH",
    "HYENI_RELEASE_CLIENT_INVENTORY_SHA256",
    "HYENI_RELEASE_PAGES_DEPLOYMENT_ID",
    "HYENI_RELEASE_PAGES_SOURCE_SHA",
    "HYENI_RELEASE_WORKER_VERSION_ID",
    "HYENI_RELEASE_WORKER_SOURCE_SHA",
    "HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_PATH",
    "HYENI_RELEASE_D1_BOOKMARK_EVIDENCE_SHA256",
    "HYENI_KNOWN_GOOD_PAGES_DIST_SHA256",
    "HYENI_KNOWN_GOOD_PAGES_ARCHIVE_PATH",
    "HYENI_KNOWN_GOOD_PAGES_ARCHIVE_SHA256",
    "HYENI_KNOWN_GOOD_WORKER_VERSION_ID",
    "HYENI_RELEASE_OBSERVATION_OWNER",
  ];
  for (const variable of evidenceVariables) {
    assert.match(releaseRecord, new RegExp(variable));
    assert.match(releaseRunbook, new RegExp(variable));
  }
  assert.match(releaseRunbook, /npm run release:record -- --out/);
  assert.match(releaseRunbook, /해시만 있고 실제 파일이 없으면 `HOLD`/);
  assert.match(releaseRunbook, /archive 자체 SHA-256[^\n]*내부 tree SHA-256/);
  assert.match(releaseRunbook, /zip-slip[^\n]*portable-name 충돌/);
  assert.match(releaseRecord, /inspectKnownGoodPagesArchive/);
  assert.match(releaseRunbook, /10분 초과 stale evidence/);
  assert.match(releaseRunbook, /c08f9b89-3418-443e-9946-e6b2c68cfc4c/);
  assert.match(releaseRunbook, /Set-Location -LiteralPath 'C:\\Users\\TK\\Desktop\\hyeni-3'/);
  assert.match(releaseRunbook, /C:\\Users\\TK\\Desktop\\hyeni-3\\node_modules\\wrangler\\bin\\wrangler\.js/);
  assert.match(releaseRunbook, /C:\\Users\\TK\\Desktop\\hyeni-3\\worker\\wrangler\.toml/);
  assert.match(releaseRunbook, /release-d1-readonly-preflight\.sql/);
  assert.match(releaseRunbook, /Get-Content -LiteralPath \$d1ReadOnlySqlPath -Raw/);
  assert.match(releaseRunbook, /node \$wranglerCli d1 execute hyeni-calendar --remote --yes --json "--command=\$d1ReadOnlySql" "--config=\$wranglerConfig"/);
  assert.match(releaseRunbook, /changes=0·changed_db=false·rows_written=0/);
  assert.match(releaseRunbook, /bookmark와 preflight 성공은 migration 쓰기 승인/);
  assert.match(releaseRunbook, /\.env`의 D1 API token 값은 출력하거나 evidence에 넣지 않는다/);
  assert.match(releaseRecord, /D1_TIME_TRAVEL_BOOKMARK_PATTERN/);
  assert.doesNotMatch(releaseRunbook, /\$env:HYENI_RELEASE_D1_BOOKMARK\s*=/);
  assert.match(releaseRunbook, /HYENI_WORKER_REPOSITORY/);
  assert.match(releaseRunbook, /HYENI_APP_REPOSITORY/);
  assert.match(releaseRunbook, /HYENI_CROSS_REPO_TOKEN/);
  assert.match(releaseRunbook, /maximumPreviouslyUsedVersionCode/);
  assert.match(releaseRunbook, /zero_public_installs/);
  assert.match(releaseRunbook, /compatibility_cutover_approved/);
  assert.doesNotMatch(releaseRecord, /HYENI_RELEASE_AAB_SIGNATURE_VERIFIED|HYENI_RELEASE_AAB_16KB_VERIFIED/);
});

test("출시 순서는 migration-first이며 Pages·Worker·Android를 독립적으로 복구한다", () => {
  const migrationIndex = releaseRunbook.indexOf("D1 migration·readback → Worker → Pages → Play 단계적 rollout");
  assert.ok(migrationIndex >= 0, "정확한 출시 순서가 필요합니다");
  assert.match(releaseRunbook, /npx wrangler rollback \$knownGoodWorkerVersionId --name hyeni-calendar-api/);
  assert.match(releaseRunbook, /Rollback to this deployment/);
  assert.match(releaseRunbook, /preview deployment는 롤백 대상이 아니다/);
  assert.match(releaseRunbook, /D1 table·column·index, R2 object, KV, Durable Object를 삭제하거나 과거 상태로 되돌리지 않는다/);
  assert.match(releaseRunbook, /더 높은 versionCode/);
  assert.match(releaseRunbook, /wrangler versions upload[^\n]*--preview-alias=[^\n]*--keep-vars --strict/);
  assert.match(releaseRunbook, /wrangler versions deploy "\$candidateWorkerVersionId@100%"[^\n]*--yes/);
  assert.match(releaseRunbook, /production ID로[^\n]*record를 다시 만든다/);
  assert.doesNotMatch(releaseRunbook, /npx wrangler deploy --tag/);
  assert.doesNotMatch(releaseRunbook, /wrangler d1 time-travel restore[^`\n]*```/);
  const playAvailabilityIndex = releaseRunbook.indexOf("Play v1.3.0(5) 대상 계정·트랙 설치 가능 확인");
  const minimumPolicyIndex = releaseRunbook.indexOf("Pages\nminimumSupportedVersion 1.3.0 적용");
  assert.ok(playAvailabilityIndex >= 0 && minimumPolicyIndex > playAvailabilityIndex);
});

test("Pages 명령은 프로젝트 env를 피하고 실제 commit과 deployment 증거를 남긴다", () => {
  assert.match(releaseRunbook, /`hyeni-3\/\.env`가 없는 임시 디렉터리/);
  assert.match(releaseRunbook, /\[System\.IO\.Path\]::GetTempPath\(\)/);
  assert.match(releaseRunbook, /--project-name=hyeni-calendar --branch=main --commit-hash=\$appSha/);
  assert.match(releaseRunbook, /pages deployment list --project-name=hyeni-calendar --environment=production --json/);
  assert.match(releaseRunbook, /gh run download \$appCiRunId/);
  assert.match(releaseRunbook, /hyeni-pages-dist-\$appSha/);
  assert.match(releaseRunbook, /pages-dist-provenance\.json/);
  assert.doesNotMatch(releaseRunbook, /release-cutover-preflight\.mjs`[^\n]*(?:사용|실행한다)/);
  assert.doesNotMatch(releaseRunbook, /\.\.\./);
});

test("첫 60분 런북은 schema health를 과신하지 않고 안전·권리·큐·rollback 기준을 갖는다", () => {
  for (const checkpoint of ["T-10", "T+0", "T+5", "T+15", "T+30", "T+45", "T+60"]) {
    assert.match(releaseRunbook, new RegExp(checkpoint.replace("+", "\\+")));
  }
  assert.match(releaseRunbook, /`\/api\/health`[^\n]*핵심/);
  assert.match(releaseRunbook, /테이블·인덱스·trigger·필수 컬럼/);
  assert.match(releaseRunbook, /단독 성공을 출시 성공으로 판정하지 않는다/);
  assert.match(releaseRunbook, /urgent_over_2m/);
  assert.match(releaseRunbook, /memo_notification_outbox/);
  assert.match(releaseRunbook, /google_play_rtdn_events/);
  assert.match(releaseRunbook, /web-billing-refund-monitor\.sql/);
  assert.match(releaseRunbook, /다른 가족·다른 아이/);
  assert.match(releaseRunbook, /fail-open/);
  assert.match(releaseRunbook, /access·refresh·purchase\/order token/);
  assert.match(releaseRunbook, /android-exit-info-summary\.mjs/);
  assert.match(releaseRunbook, /reason code 4·5·6/);
  assert.match(releaseRunbook, /description·trace·serial은 저장하지 않는다/);
  assert.match(releaseRunbook, /Android vitals → Crashes and ANRs/);
  assert.doesNotMatch(releaseRunbook, /SELECT\s+\*/i);
});

test("JWT URL 제거 배포는 새 앱·Worker의 동시 전환과 쌍 rollback을 강제한다", () => {
  assert.match(releaseRunbook, /보안 프로토콜 동시 전환 게이트/);
  assert.match(releaseRunbook, /POST \/api\/realtime\/ticket/);
  assert.match(releaseRunbook, /45초·1회용/);
  assert.match(releaseRunbook, /비공개 사진·첨부[^\n]*Authorization[^\n]*blob URL/);
  assert.match(releaseRunbook, /\/realtime\?family_id=\{familyId\}&token=\{accessJwt\}/);
  assert.match(releaseRunbook, /새 앱[^\n]*구 Worker[^\n]*realtime 연결/);
  assert.match(releaseRunbook, /A17\(`RFKL40DP73J`\) 부모와 razr\(`ZY22H9VTQD`\) 아이/);
  assert.match(releaseRunbook, /S25[^\n]*완전 무조작/);
  assert.match(releaseRunbook, /A17과 razr의 기존 세션을 보존한 `adb install -r`/);
  assert.match(releaseRunbook, /부모 역할은 A17, 아이 역할은 razr/);
  assert.match(releaseRunbook, /rollback은 검증된 Worker와 Pages 쌍/);
  assert.match(releaseRunbook, /앱을 임의 downgrade하거나 세션을 지우지 않는다/);
});

test("AAB와 PWA cutover는 machine evidence와 중요 작업 보호형 열린 탭 reload를 요구한다", () => {
  for (const evidence of [
    "jarsigner",
    "upload certificate SHA-256",
    "PAGE_ALIGNMENT_16K",
    "zipalign",
    "llvm-readelf",
    "ELF `LOAD >= 0x4000`",
  ]) {
    assert.match(releaseRunbook, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(releaseRunbook, /사람이 넣은 확인 boolean은 증거가 아니다/);
  assert.match(releaseRunbook, /navigator\.serviceWorker\.getRegistration\(\).*registration\.update/s);
  assert.match(releaseRunbook, /registerType: prompt/);
  assert.match(releaseRunbook, /중요 작업 중에는 reload가 발생하지 않고/);
  assert.match(releaseRunbook, /자동으로 한 번\s+reload/);
  assert.match(releaseRunbook, /구 chunk 404[^\n]*Console error[^\n]*0건/);
});

test("UGC 런북의 신고 종류와 사유는 앱 API 계약과 일치한다", () => {
  for (const reason of [
    "scary_or_uncomfortable",
    "abusive_language",
    "asks_personal_info",
    "inaccurate",
    "harassment",
    "sexual_or_violent",
    "personal_info",
    "illegal_or_dangerous",
    "other",
  ]) {
    assert.match(contentSafetyEndpoint, new RegExp(`"${reason}"`));
    assert.match(moderationRunbook, new RegExp(`\`${reason}\``));
  }
  assert.match(moderationRunbook, /`ai_content_report`/);
  assert.match(moderationRunbook, /`memo_content_report`/);
  assert.match(moderationRunbook, /AI·메모 원문은 신고 행에 복제하지 않는다/);
  assert.match(moderationRunbook, /AI 신고는 부모에게 자동 전달되지 않는다/);
});

test("UGC triage는 메타데이터 우선·한 건 claim·조건부 상태 전이로 제한한다", () => {
  assert.match(moderationRunbook, /rowid AS case_rowid/);
  assert.match(moderationRunbook, /status='new'/);
  assert.match(moderationRunbook, /status='reviewing'/);
  for (const status of ["escalated", "closed_no_action", "closed_actioned"]) {
    assert.match(moderationRunbook, new RegExp(status));
  }
  assert.match(moderationRunbook, /SELECT changes\(\) AS changed_rows/);
  assert.match(moderationRunbook, /민감한 원문 한 건을 열람하려면 REVIEW를 입력/);
  assert.match(moderationRunbook, /별도의 제한 case\s*기록/);
  assert.doesNotMatch(moderationRunbook, /SELECT\s+\*/i);
  assert.doesNotMatch(moderationRunbook, /\.\.\./);
});

test("UGC 운영은 메모 차단과 안전 기능을 분리하고 임의 production 조치를 금지한다", () => {
  assert.match(moderationRunbook, /가족 연결, 위치, SOS, 도착·위험 알림은 계속 전달/);
  assert.match(moderationRunbook, /운영자 전용 콘텐츠 삭제·계정 정지 API[^\n]*없다/);
  assert.match(moderationRunbook, /임의 `DELETE`·`UPDATE`하지 않는다/);
  assert.match(moderationRunbook, /`user_interaction_blocks`를 만들거나 해제하지 않는다/);
  assert.match(moderationRunbook, /mail@hyenicalendar\.com/);
  assert.match(moderationRunbook, /실제 담당자·운영 큐·데모 E2E 증거가 없으면 \*\*HOLD\*\*/);
  assert.match(moderationRunbook, /access·refresh·purchase\/order token/);
});
