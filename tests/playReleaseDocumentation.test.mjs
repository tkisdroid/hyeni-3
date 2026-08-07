import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [dataSafety, checklist, listing, guide, generator, readiness, releaseRunbook] = await Promise.all([
  read("../docs/store/play-data-safety.md"),
  read("../docs/store/play-release-checklist.md"),
  read("../docs/store/play-listing.md"),
  read("../docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md"),
  read("../scripts/create-play-release-guide.py"),
  read("../docs/reports/2026-08-01-pricing-launch-readiness.md"),
  read("../docs/release/release-day-rollback-runbook.md"),
]);

test("데이터 보안 답안은 외부 처리와 전체 데이터 범주를 제출 전 확인 항목으로 남긴다", () => {
  assert.doesNotMatch(dataSafety, /기기 내 STT/);
  assert.match(dataSafety, /SpeechRecognizer/);
  assert.match(dataSafety, /Web Speech/);
  assert.match(dataSafety, /외부 처리 가능/);
  assert.match(dataSafety, /서비스 제공자 예외/);
  assert.match(dataSafety, /미확정/);
  assert.match(dataSafety, /제출 차단/);

  for (const category of [
    "이메일",
    "사용자 ID",
    "저장 장소·주소",
    "일정",
    "설치된 앱",
    "앱 사용 시간",
    "FCM 토큰",
    "구매 내역",
  ]) {
    assert.match(dataSafety, new RegExp(category));
  }
});

test("데이터 보안 문서는 실제 외부 전송 흐름과 서비스 제공자 예외의 증거 기준을 빠짐없이 고정한다", () => {
  for (const processor of [
    "Cloudflare",
    "Firebase Cloud Messaging",
    "Google Play",
    "OpenAI",
    "Kakao",
    "Google OAuth",
    "Kakao OAuth",
    "Naver OAuth",
    "Resend",
    "NCP SENS",
    "공개 OSRM",
    "SpeechRecognizer",
    "Web Speech",
  ]) {
    assert.match(dataSafety, new RegExp(processor));
  }
  for (const field of [
    "senderName",
    "senderEmail",
    "senderRole",
    "senderUserId",
    "familyId",
    "content",
    "전화번호",
    "6자리 OTP",
    "출발·도착 좌표",
  ]) {
    assert.match(dataSafety, new RegExp(field));
  }
  assert.match(dataSafety, /계약[^\n]*보관[^\n]*2차 이용/);
  assert.match(dataSafety, /증거가 모두 확보되기 전[^\n]*서비스 제공자 예외[^\n]*적용하지 않는다/);
});

test("대상 연령과 선생님 모드는 실제 이용자·Families 적격성·심사 가능성을 출시 차단으로 결정한다", () => {
  for (const source of [listing, checklist]) {
    assert.match(source, /아이 모드[^\n]*성인 전용[^\n]*(?:금지|선택하지)/);
    assert.match(source, /정밀·백그라운드 위치[^\n]*아동 전용[^\n]*(?:금지|선택하지)/);
    assert.match(source, /아이 경로[^\n]*API\/SDK[^\n]*Families[^\n]*(?:차단|비활성)/);
    assert.match(source, /선생님 모드[^\n]*(?:정식 출시|production gate)/);
    assert.match(source, /심사 계정[^\n]*E2E/);
  }
  assert.match(guide, /아동만을 대상으로 하면 위치 권한 자체를 요청할 수 없고/);
  assert.match(guide, /정밀 위치를 수집·사용·전송할 수도 없다/);
});

test("모든 Play 트랙·결제·CALL_PHONE·증거 등급을 독립 출시 게이트로 기록한다", () => {
  for (const track of ["내부 테스트", "비공개 테스트", "공개 테스트", "프로덕션"]) {
    assert.match(checklist, new RegExp(track));
  }
  for (const billingEvidence of [
    "acknowledge",
    "PURCHASED",
    "PENDING",
    "RTDN",
    "subscriptionsv2.get",
    "복원",
  ]) {
    assert.match(checklist, new RegExp(billingEvidence.replace(/[.]/g, "\\.")));
  }
  assert.match(checklist, /CALL_PHONE[^\n]*유지/);
  assert.match(checklist, /ACTION_CALL[^\n]*ACTION_DIAL/);
  for (const evidenceClass of ["코드 증거", "자동 테스트 증거", "실기기 증거", "운영 증거", "Console 증거", "계약 증거"]) {
    assert.match(checklist, new RegExp(evidenceClass));
  }
  assert.match(checklist, /광고 없음으로 선언/);
  assert.match(checklist, /(?:광고 SDK[^\n]*최종 AAB|최종 AAB[^\n]*광고 SDK)/);
  assert.match(checklist, /Health apps 선언/);
  assert.match(checklist, /Financial features 선언/);
  assert.match(checklist, /rewards, points, other incentives/);
  assert.match(checklist, /Government apps 선언/);
  assert.match(checklist, /News apps 선언/);
  for (const source of [checklist, guide, readiness]) {
    assert.match(source, /일정(?:·반복 일정)?·메모·스티커[^\n]*무제한/);
    assert.match(source, /준비물·숙제[^\n]*아이별 하루[^\n]*8개/);
    assert.doesNotMatch(source, /일정·준비물·메모·스티커[^\n]*무제한/);
  }
  assert.match(checklist, /Toss Payments[^\n]*주문번호·금액·통화·결제 상태/);
  assert.match(guide, /Toss Payments[^\n]*주문번호·금액·통화·상태/);

  const manifestStart = checklist.indexOf("## 2026-08-01 Worker migration-first manifest");
  const manifestEnd = checklist.indexOf("## 서명 자격정보 안전 정리", manifestStart);
  assert.ok(manifestStart >= 0 && manifestEnd > manifestStart, "Worker migration manifest 범위가 필요합니다");
  const migrationManifest = checklist.slice(manifestStart, manifestEnd);
  for (const migration of [
    "ai-credit-balance-uniqueness.sql",
    "premium-funnel.sql",
    "premium-funnel-ai-schedule-limit.sql",
    "family-lifecycle-funnel.sql",
    "revenue-cost-ledger.sql",
    "location-confirmation-records.sql",
    "location-history-ingest-quota.sql",
    "location-history-retention.sql",
    "web-billing.sql",
    "web-billing-key-revocation.sql",
    "google-play-family-trial-claim.sql",
    "web-billing-refunds.sql",
    "web-billing-financial-retention.sql",
    "web-ai-credit-billing.sql",
    "web-ai-credit-financial-retention.sql",
    "referral-rewards-v2.sql",
    "google-play-rtdn-schema.sql",
    "google-play-credit-debt-disclosure.sql",
  ]) {
    assert.match(migrationManifest, new RegExp(migration.replace(/[.]/g, "\\.")));
  }
  for (const orderedMigrations of [
    ["premium-funnel.sql", "family-lifecycle-funnel.sql", "revenue-cost-ledger.sql"],
    ["location-confirmation-records.sql", "location-history-ingest-quota.sql", "location-history-retention.sql"],
    [
      "web-billing-key-revocation.sql",
      "google-play-family-trial-claim.sql",
      "web-billing-refunds.sql",
      "web-billing-financial-retention.sql",
    ],
    ["google-play-rtdn-schema.sql", "google-play-credit-debt-disclosure.sql"],
  ]) {
    let previousIndex = -1;
    for (const migration of orderedMigrations) {
      const currentIndex = migrationManifest.indexOf(migration);
      assert.ok(currentIndex > previousIndex, `${migration}의 migration 순서가 잘못됐습니다`);
      previousIndex = currentIndex;
    }
  }
  assert.match(migrationManifest, /refund_status[^\n]*customer_key[^\n]*중단/);
  assert.match(migrationManifest, /idx_referral_completions_v2_ready/);
  assert.match(migrationManifest, /trg_referral_location_evidence_snapshot/);
  for (const source of [migrationManifest, releaseRunbook]) {
    assert.match(source, /worker\/db\/premium-funnel-ai-schedule-limit\.sql/);
    assert.match(source, /premium_funnel_events[^\n]*기존|기존[^\n]*premium_funnel_events/);
    assert.match(source, /has_ai_schedule_limit_source[^\n]*0[\s\S]{0,240}정확히 1회/);
    assert.match(source, /has_ai_schedule_limit_source[^\n]*1[\s\S]{0,240}(?:필수|요구|확인|HOLD)/);
  }
  const sourceFlagReadIndex = releaseRunbook.indexOf("$hasAiScheduleLimitSource =");
  const bookmarkCaptureIndex = releaseRunbook.indexOf("$d1BookmarkJson =", sourceFlagReadIndex);
  const finalReleaseFlagGateIndex = releaseRunbook.indexOf(
    "if ($hasAiScheduleLimitSource -ne 1)",
    bookmarkCaptureIndex,
  );
  assert.ok(sourceFlagReadIndex >= 0, "AI 일정 source flag readback이 필요합니다");
  assert.ok(bookmarkCaptureIndex > sourceFlagReadIndex, "pre-migration bookmark를 source flag 뒤에 캡처해야 합니다");
  assert.ok(
    finalReleaseFlagGateIndex > bookmarkCaptureIndex,
    "flag=0 복구 bookmark를 먼저 캡처한 뒤 final release record를 차단해야 합니다",
  );
  const preMigrationCapture = releaseRunbook.slice(sourceFlagReadIndex, bookmarkCaptureIndex);
  assert.match(preMigrationCapture, /@\(0, 1\) -notcontains \$hasAiScheduleLimitSource/);
  assert.doesNotMatch(preMigrationCapture, /\$hasAiScheduleLimitSource -ne 1/);
  assert.match(checklist, /Workers Paid/);
  assert.match(checklist, /LOCATION_AUDIT_CURSOR_SECRET[^\n]*32바이트[^\n]*HMAC/);
  assert.match(checklist, /payload·서명 변조[^\n]*400/);
  assert.match(checklist, /worker\/ops\/location-confirmation-capacity\.sql/);
  assert.match(checklist, /50%[^\n]*70%[^\n]*85%/);
  assert.match(checklist, /\{ records, hasMore, nextCursor \}/);
  assert.match(checklist, /v1\.2\.0[^\n]*역사 기록/);
  assert.match(checklist, /precache 320개[^\n]*entry 472,252 bytes[^\n]*역사 증거/);
  assert.match(checklist, /격리 Free 브라우저[^\n]*저장 장소 2\/2[^\n]*Free\/Premium[^\n]*\/place-form/);
  assert.match(checklist, /246A1513CA9D9951D7857654B538398A9D175605F097331EAADDE2DBA2D243F5/);
  assert.doesNotMatch(checklist, /- \[x\][^\n]*(?:1,072\/1,072|246A1513|razr[^\n]*install -r)/);
  assert.match(checklist, /현재 실기기 승인 범위[^\n]*A17 부모[^\n]*razr 아이[^\n]*두 대/);
  assert.match(checklist, /S25[^\n]*완전 무조작/);
  assert.doesNotMatch(checklist, /A17[^\n]*한 대만 승인 범위/);
  assert.match(checklist, /client-release-inventory\.json/);
  assert.match(checklist, /compatibility_cutover_approved/);
  assert.match(checklist, /minimumSupportedVersion=1\.3\.0/);
  assert.match(checklist, /registerType: prompt/);
  assert.match(checklist, /결제·AI 크레딧 대사·주변소리·미저장 편집 중에는 reload가 보류/);
  assert.match(readiness, /미확정이거나 실패하면 Free로 추정하지 않고[^\n]*unknown[^\n]*fail-closed/);
});

test("출시 체크리스트는 AI·UGC 코드 완료와 실제 E2E 출시 게이트를 분리한다", () => {
  for (const gate of ["AI 답변 신고", "메모 신고", "사용자 차단", "UGC 약관"]) {
    assert.match(checklist, new RegExp(`- \\[x\\][^\\n]*${gate} 코드`));
    assert.match(checklist, new RegExp(`- \\[ \\][^\\n]*${gate} E2E`));
  }
  for (const source of [checklist, guide, readiness]) {
    assert.match(source, /gpt-5\.6-luna/);
    assert.match(source, /노출[^\n]*OpenAI 키[^\n]*(?:폐기|회전)/);
    assert.match(
      source,
      /(?:새 키|새 Worker secret|production Worker secret)[^\n]*(?:canary|Luna|교체|readback)/,
    );
  }
  assert.match(checklist, /활성 OpenAI 호출 4개/);
  assert.match(checklist, /(?:Gateway[^\n]*canary 3\/3|live canary 4\/4)/);
  assert.match(readiness, /실제 사용자 AI는 아직 Luna 전환 완료 상태가 아니다/);
  assert.match(checklist, /제출 차단/);
});

test("서명 절차는 비밀번호를 Gradle 인자로 넘기지 않고 임시 환경변수를 정리한다", () => {
  assert.doesNotMatch(checklist, /-PHYENI_(?:KEYSTORE_PASSWORD|KEY_PASSWORD)/);
  assert.doesNotMatch(guide, /-PHYENI_(?:KEYSTORE_PASSWORD|KEY_PASSWORD)/);
  for (const source of [checklist, guide]) {
    assert.match(source, /HYENI_KEYSTORE_PASSWORD/);
    assert.match(source, /HYENI_KEY_PASSWORD/);
    assert.match(source, /Remove-Item Env:HYENI_KEYSTORE_PASSWORD/);
    assert.match(source, /Remove-Item Env:HYENI_KEY_PASSWORD/);
  }
  assert.doesNotMatch(checklist, /- \[x\][^\n]*hyeni-upload-credentials\.txt/);
});

test("정책 체크리스트는 위치·FGS·FSI·모니터링·혼합 연령 결정을 분리한다", () => {
  for (const phrase of [
    "하나의 핵심 위치 기능",
    "prominent disclosure",
    "FOREGROUND_SERVICE_LOCATION",
    "FOREGROUND_SERVICE_MICROPHONE",
    "specialUse",
    "전화·알람 앱이 아님",
    "heads-up",
    "isMonitoringTool",
    "지속 알림",
    "고유 아이콘",
    "혼합 연령",
  ]) {
    assert.match(checklist, new RegExp(phrase.replace(/[·]/g, "[·]")));
    assert.match(guide, new RegExp(phrase.replace(/[·]/g, "[·]")));
  }
});

test("정확한 알람 제거와 전화 권한 최소화 결정을 문서에 반영한다", () => {
  for (const source of [checklist, listing, guide]) {
    assert.doesNotMatch(source, /SCHEDULE_EXACT_ALARM/);
    assert.match(source, /CALL_PHONE/);
  }
  for (const source of [checklist, guide]) {
    assert.match(source, /서버 cron/);
    assert.match(source, /정확한 알람 특별 권한[^\n]*제거/);
    assert.match(source, /inexact/);
    assert.match(source, /최소 권한/);
  }
});

test("스토어 문안은 전달을 보장하지 않고 개인정보 없는 자산과 공식 연락처를 사용한다", () => {
  assert.doesNotMatch(listing, /즉시 전달돼요|진입 시 바로 알 수 있어요/);
  assert.match(listing, /기기 권한·네트워크·배터리 상태/);
  assert.match(listing, /자녀 보호 목적의 모니터링/);
  assert.match(listing, /mail@hyenicalendar\.com/);
  assert.match(listing, /앱 · 육아\(Parenting\)/);
  assert.match(listing, /한국어\(대한민국\)[^\n]*대한민국/);
  assert.match(listing, /https:\/\/hyeni-calendar\.pages\.dev/);
  assert.match(listing, /AI 답변 신고[^\n]*제출 차단/);
  assert.match(listing, /메모 신고·사용자 차단[^\n]*제출 차단/);
});

test("16KB 승인은 AAB 설정·ZIP·ELF·실행 기기를 각각 검사한다", () => {
  for (const evidence of [
    "PAGE_ALIGNMENT_16K",
    "zipalign -c -P 16",
    "llvm-readelf",
    "getconf PAGE_SIZE",
  ]) {
    assert.match(guide, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(guide, /ELF `LOAD` alignment가 `0x4000` 이상/);
  assert.match(guide, /16KB 런타임·앱 시작/);
});

test("targetSdk 36 출시는 네이티브 대화면 회전과 상태 보존을 별도 차단 조건으로 둔다", () => {
  for (const evidence of ["sw600dp", "세로·가로 회전", "분할 화면", "폴더블", "상태 보존"]) {
    assert.match(guide, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(guide, /A17 세로 화면과 브라우저 360×800 검증은 네이티브 대화면 검증을 대신하지 않는다/);
});

test("AI 아이 대화와 자동 앱 사용 보고를 Data Safety·스토어 문안에 정확히 공개한다", () => {
  assert.match(dataSafety, /아이가 AI 친구에 입력한 프롬프트·대화와 assistant 답변/);
  assert.match(dataSafety, /ai_chat_messages/);
  assert.match(dataSafety, /설치된 앱 중 최근 많이 사용한 상위 5개의 packageName/);
  assert.match(dataSafety, /사용 시간·최근 사용 시각/);
  assert.doesNotMatch(listing, /선택한 앱 사용정보/);
  assert.match(listing, /최근 많이 사용한 앱 최대 5개의 앱 식별자·사용 시간·최근 사용 시각/);
});

test("App Link와 아이 흐름 검증은 A17 serial과 격리 브라우저 역할을 분리한다", () => {
  assert.match(guide, /adb -s RFKL40DP73J shell pm verify-app-links/);
  assert.match(guide, /adb -s RFKL40DP73J shell pm get-app-links/);
  assert.doesNotMatch(guide, /`adb shell pm (?:verify-app-links|get-app-links)/);
  assert.match(guide, /#\/child\/ai-friend/);
  assert.match(guide, /#\/child\/memo/);
  assert.match(guide, /네이티브 아이 FCM·pending 표시 ACK/);
  assert.doesNotMatch(guide, /install -r \.\.\./);
  assert.match(guide, /install -r android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
});

test("가이드 생성기는 compact_reference_guide의 고정 지오메트리와 실제 numbering을 사용한다", () => {
  assert.match(generator, /Inches\(8\.5\)/);
  assert.match(generator, /Inches\(11\)/);
  assert.equal((generator.match(/margin = Inches\(1(?:\.0)?\)/g) ?? []).length, 4);
  assert.match(generator, /table\.autofit = False/);
  for (const tag of ["w:tblW", "w:tblInd", "w:gridCol", "w:tcW"])
    assert.match(generator, new RegExp(tag));
  assert.match(generator, /w:abstractNum/);
  assert.match(generator, /w:numPr/);
  assert.match(generator, /w:startOverride/);
  assert.match(generator, /w:suff/);
  assert.match(generator, /w:cantSplit/);
  assert.doesNotMatch(generator, /add_run\(f"\{numbered\.group\(1\)\}\. "/);
  assert.doesNotMatch(generator, /text\.text = "1"/);
  assert.doesNotMatch(generator, /SOURCE = ROOT/);
  assert.doesNotMatch(generator, /OUTPUT = ROOT/);
  assert.doesNotMatch(generator, /2026-07-14/);
  assert.match(generator, /sys\.stdout\.reconfigure\(encoding="utf-8"\)/);
});

test("가이드 생성기는 짧은 표 행만 페이지 분할을 막고 장문 본문 행은 분할을 허용한다", () => {
  assert.match(generator, /TABLE_ROW_KEEP_TOGETHER_MAX_CHARS = 180/);
  assert.match(
    generator,
    /def should_keep_table_row_together\(row_index: int, values: list\[str\]\) -> bool:\s+if row_index == 0:\s+return True\s+return sum\(len\(value\.strip\(\)\) for value in values\) <= TABLE_ROW_KEEP_TOGETHER_MAX_CHARS/,
  );
  assert.match(
    generator,
    /if should_keep_table_row_together\(row_index, values\) and row_props\.find\(qn\("w:cantSplit"\)\) is None:/,
  );
  assert.equal((generator.match(/OxmlElement\("w:cantSplit"\)/g) ?? []).length, 1);
});

test("가이드 생성기는 짝수 페이지에도 독립 머리글과 바닥글을 넣는다", () => {
  assert.match(generator, /odd_and_even_pages_header_footer = True/);
  assert.match(generator, /section\.even_page_header/);
  assert.match(generator, /section\.even_page_footer/);
});

test("가이드 생성기는 표지 다음 도입 문단과 인용문 인라인 강조를 보존한다", () => {
  assert.match(generator, /def is_cover_metadata_line/);
  assert.match(generator, /not is_cover_metadata_line\(stripped\)/);
  assert.match(generator, /add_inline\(paragraph, stripped\[2:\]\)/);
  assert.doesNotMatch(generator, /add_run\(stripped\[2:\]\)/);
  assert.doesNotMatch(generator, /startswith\("15\. 최종 서명"\)/);
});
